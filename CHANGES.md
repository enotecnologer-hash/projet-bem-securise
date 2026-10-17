# Corrections appliquées

## Bloquants (le projet ne pouvait pas fonctionner)
1. `ingest/index.ts`: bloc `} catch` en trop (erreur de syntaxe) supprimé. Fonction réécrite, vérifiée avec `tsc`.
2. CORS: la fonction répond maintenant au préflight `OPTIONS` (+ `allow-headers`). `audit.js` envoie le token dans le corps en `text/plain` (requête simple, sans préflight), donc `sendBeacon` fonctionne aussi.
3. `schema.sql`: la policy `profiles` lisait `profiles` (récursion infinie). Remplacée par des fonctions `SECURITY DEFINER` (`current_org_id`, `is_platform_owner`, `is_org_admin`).
4. `loss_rules`: la RLS n'était pas activée (table ouverte via la clé anon). Activée + policies + `revoke ... from anon`.
5. Vérification des domaines: l'owner voit tous les domaines et passe `is_verified` à true (policy `domains_owner_update`).
6. `daily_losses`: alimentée par le trigger `bump_daily_loss` à chaque insertion dans `error_events` (le dashboard affichait toujours 0 DH).
7. `schema.sql`: la contrainte unique `(id, organization_id)` sur `domains` était créée APRÈS la clé étrangère qui en dépend (échec à l'exécution). Déplacée dans la table.

## Sécurité
- Rôle `owner` = propriétaire de la plateforme; `admin` = admin de sa seule organisation. Un admin ne peut ni créer ni promouvoir un `owner`, ni marquer un domaine comme vérifié.
- `attach_user_to_org(email, organization_id, role)`: rattache un utilisateur sans voler ceux d'une autre organisation.
- Contrainte `www` sur `domains.domain_name` réparée (regex mal échappée).
- `audit.js`: masque emails et numéros dans les messages, ne s'auto-signale plus (fetch natif pour ses envois), plafond de 30 événements par page.
- `ingest`: corps limité à 64 Ko; un événement comportemental sans consentement est ignoré (les erreurs techniques passent).

## audit.js
- Initialisation automatique depuis `data-token` et `data-api`; `BEM.consent(true|false)` pour la bannière CNDP.
- Envoi par lots, `visibilitychange` + `pagehide` pour l'abandon de formulaire (mobile).

## Divers
- Dashboard: la perte affichée est bien celle des 7 derniers jours; échelle des barres corrigée.
- `layout.tsx`: `lang="fr"`, titre et description. `.env.example` ajouté.

# Ordre d'installation
1. SQL Editor: `schema.sql` puis `admin.sql`.
2. `supabase functions deploy ingest --no-verify-jwt`.
3. Variables du site: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (voir `.env.example`).
4. Connectez-vous une fois, puis la commande `update public.profiles set role = 'owner' ...` en bas de `admin.sql`.
5. Créez l'organisation, ses domaines, passez `is_verified` à true, définissez `loss_rules`.
6. Sur le site du client: `<script src=".../audit.js" defer data-token="<verification_token du domaine>" data-api="https://XXXX.supabase.co/functions/v1/ingest"></script>`

# Non traité (à décider)
- Aucune interface de connexion ni d'administration (créer organisations, domaines, règles, liens utilisateurs): tout se fait en SQL pour l'instant.
- `@vercel/analytics` dans le layout sur un outil contenant des données clients; `ignoreBuildErrors: true` dans `next.config.mjs` masque les erreurs TypeScript.
- Le consentement est déclaré par le navigateur (`consent: true`); la table `cndp_consents` n'est alimentée par rien.
- Pas de limitation de débit par domaine (à ajouter côté Cloudflare ou Supabase).
- Versions de `next`, `shadcn`, `@base-ui/react`, `pnpm` non vérifiées (pas d'accès réseau ici); `pnpm install && pnpm build` à lancer chez vous.
- SQL non exécuté sur un vrai Postgres: à tester sur un projet Supabase vide.

# Ajouts « protection des données »
- `security.sql`: journal d'audit en ajout seul (sans tokens), limitation de débit par domaine, purge à 90 jours, `export_organization_data`, `erase_organization`.
- `ingest`: appelle `ingest_allowed` et répond 429 avec `retry-after` au-delà de 600 événements par minute et par domaine.
- `security_checks.sql`: requêtes de vérification (RLS, droits de l'anonyme, exposition des fonctions, tokens dans le journal).
- `next.config.mjs`: CSP (production), HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, nosniff.
- `layout.tsx`: `@vercel/analytics` retiré (aucun outil tiers). Pour finir: `pnpm remove @vercel/analytics`.
- `SECURITE.md`: données collectées, contrôles, checklist de mise en production, procédures, limites.
- Ordre d'exécution SQL: `schema.sql`, `admin.sql`, `security.sql`, puis `security_checks.sql`.

# Ajouts « connexion, MFA et administration »
- `/login`: code email à 6 chiffres (`shouldCreateUser: false`, message identique que le compte existe ou non), puis TOTP obligatoire (activation avec QR code ou vérification). Redirection interne uniquement.
- `/admin` (rôles owner et admin): organisations, domaines (script à copier, vérification réservée à l'owner), valeurs de perte, utilisateurs, export JSON, suppression avec confirmation, journal d'audit (owner).
- Base: policies restrictives `require_mfa` (AAL2) sur 8 tables; `is_org_admin` et `is_platform_owner` exigent AAL2; nouvelles fonctions `list_org_members` et `detach_user_from_org`.
- `lib/supabase.ts` (client unique), `lib/auth.ts`, `components/auth-gate.tsx`, `components/session-bar.tsx`, `components/bem-ui.tsx`.
- `/dashboard` redirige vers `/login` sans session ou sans second facteur.
- Réglages Supabase à faire: voir `SECURITE.md`, section 3, points 9 et 10.
