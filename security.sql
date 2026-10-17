-- BEM, protection des données. À exécuter APRÈS schema.sql et admin.sql.

-- ============================================================
-- 1. Journal d'audit en ajout seul (qui a changé quoi, et quand)
-- ============================================================
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,                 -- auth.uid(); null pour le service role ou le SQL Editor
  action text not null,          -- INSERT, UPDATE, DELETE
  table_name text not null,
  row_id text,
  organization_id uuid,          -- volontairement sans clé étrangère: le journal survit à la suppression
  changes jsonb not null default '{}'
);
create index audit_log_org_time on public.audit_log (organization_id, occurred_at desc);

alter table public.audit_log enable row level security;
create policy audit_log_owner_select on public.audit_log
  for select to authenticated using (public.is_platform_owner());
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log est en ajout seul';
end;
$$;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- Le verification_token (secret d'ingestion) n'est jamais écrit dans le journal.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  diff jsonb;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into diff
      from jsonb_each(to_jsonb(old)) as o(key, value)
      join jsonb_each(to_jsonb(new)) as n(key, value) using (key)
      where o.value is distinct from n.value;
  else
    diff := r;
  end if;
  diff := diff - 'verification_token';

  insert into public.audit_log (actor_id, action, table_name, row_id, organization_id, changes)
  values (
    (select auth.uid()),
    tg_op,
    tg_table_name,
    coalesce(r->>'id', (r->>'organization_id') || ':' || (r->>'event_type')),
    coalesce(r->>'organization_id', case when tg_table_name = 'organizations' then r->>'id' end)::uuid,
    diff
  );
  return null;
end;
$$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function public.audit_row_change();
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();
create trigger audit_domains after insert or update or delete on public.domains
  for each row execute function public.audit_row_change();
create trigger audit_loss_rules after insert or update or delete on public.loss_rules
  for each row execute function public.audit_row_change();
create trigger audit_cndp_consents after insert or update or delete on public.cndp_consents
  for each row execute function public.audit_row_change();

-- ============================================================
-- 2. Limitation de débit par domaine (appelée par l'Edge Function)
-- ============================================================
create table public.ingest_rate (
  domain_id uuid not null references public.domains(id) on delete cascade,
  window_start timestamptz not null,
  events integer not null default 0,
  primary key (domain_id, window_start)
);
alter table public.ingest_rate enable row level security;   -- aucune policy: service role uniquement
revoke all on public.ingest_rate from anon, authenticated;

create or replace function public.ingest_allowed(p_domain_id uuid, p_events integer, p_limit integer default 600)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  total integer;
begin
  insert into public.ingest_rate (domain_id, window_start, events)
  values (p_domain_id, date_trunc('minute', now()), p_events)
  on conflict (domain_id, window_start)
  do update set events = public.ingest_rate.events + excluded.events
  returning events into total;
  return total <= p_limit;       -- 600 événements par minute et par domaine par défaut
end;
$$;
revoke execute on function public.ingest_allowed(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ingest_allowed(uuid, integer, integer) to service_role;

-- ============================================================
-- 3. Rétention: suppression automatique des événements bruts
--    (daily_losses, agrégée et sans donnée brute, est conservée)
-- ============================================================
create or replace function public.purge_old_data(retention_days integer default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n_events bigint;
  n_rate bigint;
begin
  if retention_days < 7 then raise exception 'Durée de rétention trop courte'; end if;
  delete from public.error_events where created_at < now() - make_interval(days => retention_days);
  get diagnostics n_events = row_count;
  delete from public.ingest_rate where window_start < now() - interval '1 day';
  get diagnostics n_rate = row_count;
  return jsonb_build_object('error_events', n_events, 'ingest_rate', n_rate);
end;
$$;
revoke execute on function public.purge_old_data(integer) from public, anon, authenticated;
grant execute on function public.purge_old_data(integer) to service_role;

-- Planification quotidienne (activer l'extension pg_cron dans Supabase > Database > Extensions):
-- select cron.schedule('bem-purge', '0 3 * * *', $$select public.purge_old_data(90)$$);

-- ============================================================
-- 4. Droits des clients: export et suppression d'une organisation
-- ============================================================
create or replace function public.export_organization_data(target_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_admin(target_organization_id) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'organization', (select to_jsonb(o) from public.organizations o where o.id = target_organization_id),
    'domains', coalesce((select jsonb_agg(to_jsonb(d) - 'verification_token')
                         from public.domains d where d.organization_id = target_organization_id), '[]'::jsonb),
    'loss_rules', coalesce((select jsonb_agg(to_jsonb(l))
                            from public.loss_rules l where l.organization_id = target_organization_id), '[]'::jsonb),
    'daily_losses', coalesce((select jsonb_agg(to_jsonb(x) order by x.loss_date)
                              from public.daily_losses x where x.organization_id = target_organization_id), '[]'::jsonb),
    'error_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at)
                              from public.error_events e where e.organization_id = target_organization_id), '[]'::jsonb)
  );
end;
$$;

-- Fin de contrat: supprime l'organisation et, en cascade, ses domaines, événements, règles et agrégats.
-- Les comptes utilisateurs restent (profil détaché). Le journal d'audit garde la trace de la suppression.
create or replace function public.erase_organization(target_organization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_owner() then raise exception 'forbidden'; end if;
  delete from public.organizations where id = target_organization_id;
end;
$$;

revoke execute on function public.export_organization_data(uuid), public.erase_organization(uuid)
  from public, anon;
grant execute on function public.export_organization_data(uuid), public.erase_organization(uuid)
  to authenticated;

-- ============================================================
-- 5. Double authentification obligatoire côté base (AAL2)
--    Les policies RESTRICTIVE s'ajoutent à toutes les autres: sans second facteur validé,
--    un utilisateur connecté ne lit ni n'écrit rien, même en contournant l'interface.
--    (is_org_admin et is_platform_owner exigent aussi AAL2: voir schema.sql.)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'domains', 'cndp_consents',
    'error_events', 'daily_losses', 'loss_rules', 'audit_log'
  ] loop
    execute format(
      'create policy require_mfa on public.%I as restrictive for all to authenticated '
      'using (coalesce((select auth.jwt()) ->> ''aal'', '''') = ''aal2'') '
      'with check (coalesce((select auth.jwt()) ->> ''aal'', '''') = ''aal2'')', t);
  end loop;
end $$;
