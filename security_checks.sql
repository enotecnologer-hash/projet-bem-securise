-- BEM, vérifications de sécurité. À exécuter dans le SQL Editor après les 3 scripts, et après chaque changement de schéma.

-- 1. Tables du schéma public sans RLS. Résultat attendu: 0 ligne.
select tablename from pg_tables where schemaname = 'public' and not rowsecurity;

-- 2. Privilèges de l'anonyme (clé publique) sur les tables. Résultat attendu: 0 ligne.
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon';

-- 3. Fonctions du schéma public exécutables par PUBLIC ou anon. Résultat attendu: 0 ligne.
select routine_name, grantee
from information_schema.routine_privileges
where routine_schema = 'public' and grantee in ('PUBLIC', 'anon');

-- 4. Tables avec RLS mais sans aucune policy (accessibles seulement au service role). Attendu: ingest_rate.
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);

-- 5. Test négatif en anonyme: chaque requête doit échouer avec "permission denied".
-- (Exécuter ligne par ligne, puis "reset role;")
-- set role anon;
-- select * from public.loss_rules;
-- select * from public.error_events;
-- select * from public.audit_log;
-- reset role;

-- 6. Le journal d'audit refuse toute modification. Attendu: erreur "audit_log est en ajout seul".
-- update public.audit_log set action = 'X' where false;  -- sans ligne concernée, le trigger ne se déclenche pas
-- delete from public.audit_log where id = (select min(id) from public.audit_log);

-- 7. Tokens non fuités dans le journal. Résultat attendu: 0.
select count(*) from public.audit_log where changes::text ilike '%verification_token%';

-- 8. Policies MFA restrictives présentes. Résultat attendu: 8 lignes (une par table protégée).
select tablename from pg_policies
where schemaname = 'public' and policyname = 'require_mfa' and permissive = 'RESTRICTIVE'
order by tablename;
