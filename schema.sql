-- BEM — Schéma principal Supabase/Postgres
-- Exécuter en premier dans le SQL Editor Supabase.
-- Aucun seed de données métier n'est effectué.

create extension if not exists pgcrypto;

do $$
begin
  create type public.profile_role as enum ('owner', 'admin', 'viewer');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.error_event_type as enum (
    'formulaire_abandonne',
    'erreur_api',
    'page_lente',
    'fichier_casse',
    'erreur_js'
  );
exception
  when duplicate_object then null;
end $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  ice text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  role public.profile_role not null default 'viewer',
  created_at timestamptz not null default now()
);

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain_name text not null unique,
  is_verified boolean not null default false,
  verification_token text not null default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  constraint domains_id_organization_unique unique (id, organization_id),
  constraint domains_name_format check (
    domain_name = lower(domain_name)
    and domain_name !~ '^https?://'
    and domain_name !~ '/'
    and domain_name !~ '^www\.'
    and domain_name !~ '[[:space:]]'
  )
);

create table public.cndp_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain_id uuid not null references public.domains(id) on delete cascade,
  consent_type text not null check (length(trim(consent_type)) between 1 and 100),
  granted boolean not null,
  ip_address inet,
  user_agent text,
  granted_at timestamptz not null default now(),
  constraint cndp_consents_domain_org_fk
    foreign key (domain_id, organization_id)
    references public.domains (id, organization_id)
);

create table public.error_events (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domains(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type public.error_event_type not null,
  session_id text check (session_id is null or length(session_id) <= 200),
  url text not null check (length(url) <= 2048),
  metadata jsonb not null default '{}'::jsonb,
  perte_dh numeric(12, 2) not null default 0 check (perte_dh >= 0),
  created_at timestamptz not null default now(),
  constraint error_events_domain_org_fk
    foreign key (domain_id, organization_id)
    references public.domains (id, organization_id)
);

create table public.loss_rules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type public.error_event_type not null,
  amount_dh numeric(12, 2) not null check (amount_dh >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, event_type)
);

create table public.daily_losses (
  domain_id uuid not null references public.domains(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loss_date date not null,
  problem_count integer not null default 0 check (problem_count >= 0),
  total_loss_dh numeric(14, 2) not null default 0 check (total_loss_dh >= 0),
  updated_at timestamptz not null default now(),
  primary key (domain_id, loss_date),
  constraint daily_losses_domain_org_fk
    foreign key (domain_id, organization_id)
    references public.domains (id, organization_id)
);

create index if not exists profiles_organization_id_idx
  on public.profiles (organization_id);
create index if not exists domains_organization_id_idx
  on public.domains (organization_id);
create index if not exists cndp_consents_domain_id_idx
  on public.cndp_consents (domain_id);
create index if not exists error_events_org_created_at_idx
  on public.error_events (organization_id, created_at desc);
create index if not exists error_events_domain_created_at_idx
  on public.error_events (domain_id, created_at desc);
create index if not exists daily_losses_organization_date_idx
  on public.daily_losses (organization_id, loss_date desc);

-- Fonctions d'aide SECURITY DEFINER utilisées par les policies.
-- Elles lisent profiles sans repasser par la RLS: c'est ce qui évite la récursion infinie.
create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select organization_id from public.profiles where id = (select auth.uid());
$$;

-- "owner" = propriétaire de la plateforme (vous): il administre toutes les organisations.
create or replace function public.is_platform_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'owner'::public.profile_role
      and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
  );
$$;

-- "admin" = administrateur de sa propre organisation seulement.
create or replace function public.is_org_admin(target_organization_id uuid default null)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
      and (
        p.role = 'owner'::public.profile_role
        or (target_organization_id is not null
            and p.role = 'admin'::public.profile_role
            and p.organization_id = target_organization_id)
      )
  );
$$;

revoke execute on function public.current_org_id(), public.is_platform_owner(), public.is_org_admin(uuid)
  from public, anon;
grant execute on function public.current_org_id(), public.is_platform_owner(), public.is_org_admin(uuid)
  to authenticated;

-- daily_losses est alimentée automatiquement à chaque insertion dans error_events.
create or replace function public.bump_daily_loss()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.daily_losses (domain_id, organization_id, loss_date, problem_count, total_loss_dh)
  values (new.domain_id, new.organization_id, (new.created_at at time zone 'UTC')::date, 1, new.perte_dh)
  on conflict (domain_id, loss_date) do update
    set problem_count = public.daily_losses.problem_count + 1,
        total_loss_dh = public.daily_losses.total_loss_dh + excluded.total_loss_dh,
        updated_at = now();
  return new;
end;
$$;

revoke execute on function public.bump_daily_loss() from public, anon, authenticated;

create trigger error_events_bump_daily
after insert on public.error_events
for each row execute function public.bump_daily_loss();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.domains enable row level security;
alter table public.cndp_consents enable row level security;
alter table public.error_events enable row level security;
alter table public.loss_rules enable row level security;
alter table public.daily_losses enable row level security;

-- Lecture: un membre voit son organisation; owner/admin voient ce qu'ils administrent.
-- Les politiques d'écriture sont dans admin.sql.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_org_id() or public.is_org_admin(id));

create policy organizations_owner_insert on public.organizations
  for insert to authenticated
  with check (public.is_platform_owner());

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or organization_id = public.current_org_id()
    or public.is_org_admin(organization_id)
  );

create policy domains_select on public.domains
  for select to authenticated
  using (
    (is_verified and organization_id = public.current_org_id())
    or public.is_org_admin(organization_id)
  );

create policy cndp_consents_select on public.cndp_consents
  for select to authenticated
  using (organization_id = public.current_org_id() or public.is_org_admin(organization_id));

create policy error_events_select on public.error_events
  for select to authenticated
  using (
    (organization_id = public.current_org_id()
      and exists (select 1 from public.domains d where d.id = error_events.domain_id and d.is_verified))
    or public.is_org_admin(organization_id)
  );

create policy daily_losses_select on public.daily_losses
  for select to authenticated
  using (
    (organization_id = public.current_org_id()
      and exists (select 1 from public.domains d where d.id = daily_losses.domain_id and d.is_verified))
    or public.is_org_admin(organization_id)
  );

create policy loss_rules_select on public.loss_rules
  for select to authenticated
  using (organization_id = public.current_org_id() or public.is_org_admin(organization_id));

revoke all on public.organizations, public.profiles, public.domains, public.cndp_consents,
  public.error_events, public.daily_losses, public.loss_rules from anon;
grant select on public.organizations, public.profiles, public.domains, public.cndp_consents,
  public.error_events, public.daily_losses, public.loss_rules to authenticated;

comment on table public.cndp_consents is
  'Trace explicite des consentements CNDP. Aucun suivi comportemental ne doit être ingéré sans consentement accordé.';
comment on table public.daily_losses is
  'Agrégation journalière alimentée par un flux serveur de confiance.';
comment on column public.error_events.perte_dh is
  'Valeur calculée côté serveur; une valeur fournie par le navigateur ne doit jamais être acceptée telle quelle.';
comment on column public.organizations.is_demo is
  'Signale explicitement les données de démonstration; aucune donnée fictive ne doit être mélangée à la production.';
