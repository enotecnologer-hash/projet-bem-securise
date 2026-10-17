-- BEM — Administration, fonctions et politiques Supabase/Postgres
-- Exécuter après schema.sql.
-- Aucun seed d'organisation, d'utilisateur ou de donnée fictive.

-- is_org_admin, is_platform_owner et current_org_id sont définies dans schema.sql.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, organization_id, role)
  values (new.id, null, 'viewer'::public.profile_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Remplace une éventuelle version précédente sans changer la signature publique.
create or replace function public.calculate_perte_dh(
  event_type public.error_event_type,
  event_metadata jsonb default '{}'::jsonb,
  event_organization_id uuid default null
)
returns numeric(12, 2)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select lr.amount_dh
    from public.loss_rules lr
    where lr.organization_id = event_organization_id
      and lr.event_type = calculate_perte_dh.event_type
  ), 0.00)::numeric(12, 2);
$$;

revoke execute on function public.calculate_perte_dh(public.error_event_type, jsonb, uuid)
  from public, anon, authenticated;

-- Le paramètre metadata est conservé pour compatibilité avec l'ingestion future.
comment on function public.calculate_perte_dh(public.error_event_type, jsonb, uuid) is
  'Lit la règle DH de l’organisation. Retourne zéro si aucune règle n’est configurée. Le metadata navigateur est ignoré pour éviter la falsification.';

-- Politiques d'administration. Les fonctions SECURITY DEFINER évitent la récursion
-- de RLS lors de la vérification du rôle dans profiles.
create policy organizations_admin_update on public.organizations
  for update to authenticated
  using (public.is_org_admin(organizations.id))
  with check (public.is_org_admin(organizations.id));

-- Un admin d'organisation ne peut jamais créer ni promouvoir un "owner" (propriétaire de la plateforme).
create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_org_admin(profiles.organization_id)
    and (profiles.role <> 'owner'::public.profile_role or public.is_platform_owner())
  );

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_org_admin(profiles.organization_id))
  with check (
    public.is_org_admin(profiles.organization_id)
    and (profiles.role <> 'owner'::public.profile_role or public.is_platform_owner())
  );

create policy profiles_admin_delete on public.profiles
  for delete to authenticated
  using (public.is_org_admin(profiles.organization_id));

-- Un domaine ajouté par un admin d'organisation est toujours non vérifié.
create policy domains_admin_insert on public.domains
  for insert to authenticated
  with check (
    public.is_org_admin(domains.organization_id)
    and (not domains.is_verified or public.is_platform_owner())
  );

-- Seul le propriétaire de la plateforme vérifie un domaine (is_verified) ou le modifie.
create policy domains_owner_update on public.domains
  for update to authenticated
  using (public.is_platform_owner())
  with check (public.is_platform_owner());

create policy domains_admin_delete on public.domains
  for delete to authenticated
  using (public.is_org_admin(domains.organization_id));

create policy cndp_consents_admin_insert on public.cndp_consents
  for insert to authenticated
  with check (public.is_org_admin(cndp_consents.organization_id));

create policy cndp_consents_admin_update on public.cndp_consents
  for update to authenticated
  using (public.is_org_admin(cndp_consents.organization_id))
  with check (public.is_org_admin(cndp_consents.organization_id));

create policy loss_rules_admin_select on public.loss_rules
  for select to authenticated
  using (public.is_org_admin(loss_rules.organization_id));

create policy loss_rules_admin_insert on public.loss_rules
  for insert to authenticated
  with check (public.is_org_admin(loss_rules.organization_id));

create policy loss_rules_admin_update on public.loss_rules
  for update to authenticated
  using (public.is_org_admin(loss_rules.organization_id))
  with check (public.is_org_admin(loss_rules.organization_id));

create policy loss_rules_admin_delete on public.loss_rules
  for delete to authenticated
  using (public.is_org_admin(loss_rules.organization_id));

create policy daily_losses_admin_select on public.daily_losses
  for select to authenticated
  using (public.is_org_admin(daily_losses.organization_id));

comment on function public.handle_new_user() is
  'Crée automatiquement un profil sans organisation; le rattachement doit être réalisé par un flux d’administration contrôlé.';

-- Vérifications facultatives après exécution:
-- select to_regclass('public.organizations'), to_regclass('public.loss_rules');
-- select tgname from pg_trigger where tgname = 'on_auth_user_created';
-- select public.calculate_perte_dh('erreur_js'::public.error_event_type, '{}'::jsonb, null);

-- Privilèges de table nécessaires aux écritures (les policies ci-dessus restent le vrai contrôle).
grant insert, update, delete on public.profiles, public.domains, public.cndp_consents, public.loss_rules
  to authenticated;
grant insert, update on public.organizations to authenticated;

-- Rattacher un utilisateur (déjà connecté une fois) à une organisation.
-- Un admin d'organisation ne peut pas prendre un utilisateur qui appartient déjà à une autre organisation.
create or replace function public.attach_user_to_org(
  user_email text,
  target_organization_id uuid,
  target_role public.profile_role default 'viewer'
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid;
begin
  if not public.is_org_admin(target_organization_id) then raise exception 'forbidden'; end if;
  if target_role = 'owner'::public.profile_role and not public.is_platform_owner() then
    raise exception 'forbidden';
  end if;
  select id into uid from auth.users where lower(email) = lower(user_email);
  if uid is null then
    raise exception 'Utilisateur introuvable: il doit se connecter une fois au tableau de bord.';
  end if;
  update public.profiles
    set organization_id = target_organization_id, role = target_role
    where id = uid
      and (organization_id is null or organization_id = target_organization_id or public.is_platform_owner());
  if not found then raise exception 'Cet utilisateur appartient déjà à une autre organisation.'; end if;
end;
$$;

revoke execute on function public.attach_user_to_org(text, uuid, public.profile_role) from public, anon;
grant execute on function public.attach_user_to_org(text, uuid, public.profile_role) to authenticated;

-- Devenir propriétaire de la plateforme (à exécuter une seule fois, dans le SQL Editor):
-- 1. Connectez-vous une fois à l'application: votre profil est créé automatiquement.
-- 2. update public.profiles set role = 'owner'
--      where id = (select id from auth.users where email = 'votre@email.com');
-- Ensuite: créer une organisation, ajouter ses domaines, passer is_verified à true (owner seulement),
-- définir loss_rules, puis attach_user_to_org('contact@client.ma', '<organization_id>').

-- Membres d'une organisation avec leur email (auth.users n'est pas lisible depuis l'interface).
create or replace function public.list_org_members(target_organization_id uuid)
returns table (user_id uuid, email text, role public.profile_role)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_org_admin(target_organization_id) then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.role
    from public.profiles p join auth.users u on u.id = p.id
    where p.organization_id = target_organization_id
    order by u.email;
end;
$$;

-- Retirer un utilisateur d'une organisation (jamais soi-même, jamais un owner sans être owner).
create or replace function public.detach_user_from_org(target_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  target_role public.profile_role;
begin
  select organization_id, role into org, target_role from public.profiles where id = target_user_id;
  if org is null then return; end if;
  if not public.is_org_admin(org) then raise exception 'forbidden'; end if;
  if target_user_id = (select auth.uid()) then raise exception 'Vous ne pouvez pas vous retirer vous-même.'; end if;
  if target_role = 'owner'::public.profile_role and not public.is_platform_owner() then raise exception 'forbidden'; end if;
  update public.profiles set organization_id = null, role = 'viewer' where id = target_user_id;
end;
$$;

revoke execute on function public.list_org_members(uuid), public.detach_user_from_org(uuid) from public, anon;
grant execute on function public.list_org_members(uuid), public.detach_user_from_org(uuid) to authenticated;
