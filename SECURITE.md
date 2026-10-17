# BEM, protection des données

Ce document décrit ce que BEM collecte, comment c'est protégé et ce qu'il vous reste à faire. Ce n'est pas un avis juridique: faites valider la partie loi 09-08 / CNDP par un juriste ou directement auprès de la CNDP.

## 1. Ce qui est collecté (et ce qui ne l'est pas)

| Collecté | Détail |
|---|---|
| Type d'événement | `erreur_js`, `erreur_api`, `page_lente`, `fichier_casse`, `formulaire_abandonne` |
| Page concernée | URL **sans paramètres ni ancre** |
| Contexte technique | code HTTP, durée de chargement, message d'erreur **avec emails et numéros masqués** |
| Identifiant de session | texte aléatoire **recréé à chaque page vue**, jamais stocké sur l'appareil |

**Jamais collecté**: valeurs saisies dans les formulaires, cookies, identifiant persistant, empreinte du navigateur, adresse IP (BEM ne l'enregistre pas; les journaux techniques de votre hébergeur peuvent la contenir, voir section 5).

Conséquence: les événements ne permettent pas de suivre une personne d'une visite à l'autre. Le seul événement comportemental (`formulaire_abandonne`) n'est envoyé qu'après consentement du visiteur.

## 2. Contrôles techniques en place

- **Isolation des clients**: RLS sur toutes les tables. Un utilisateur ne voit que son organisation.
- **Rôles**: `owner` (vous, toute la plateforme), `admin` (sa seule organisation), `viewer` (lecture). Un admin ne peut ni créer un `owner`, ni valider un domaine.
- **Ingestion**: token + domaine vérifié + origine du navigateur, corps limité à 64 Ko, 600 événements par minute et par domaine (`ingest_allowed`).
- **Calcul de la perte côté serveur uniquement**; la valeur envoyée par le navigateur est ignorée.
- **Journal d'audit en ajout seul** (`audit_log`): toute modification des organisations, profils, domaines, règles et consentements est tracée. Les tokens n'y figurent jamais.
- **Rétention**: événements bruts supprimés après 90 jours (`purge_old_data`); seules les agrégations journalières sont gardées.
- **Droits des clients**: `export_organization_data` (portabilité) et `erase_organization` (suppression complète en fin de contrat).
- **Accès**: connexion par code à 6 chiffres envoyé par email (les comptes sont créés par l'administrateur, l'inscription libre est désactivée côté application) puis **double authentification TOTP obligatoire**. La base applique la règle elle-même: policies restrictives `require_mfa` sur toutes les tables, et `is_org_admin` / `is_platform_owner` exigent aussi AAL2.
- **Navigateur**: en-têtes `Content-Security-Policy` (production), HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; aucun outil d'analyse tiers.
- **Vérifications**: `security_checks.sql` (RLS, droits de l'anonyme, exposition des fonctions).

## 3. À faire avant la mise en production

1. Exécuter `schema.sql`, `admin.sql`, `security.sql`, puis **`security_checks.sql`**: tous les résultats doivent correspondre aux attentes écrites dans le fichier.
2. Activer l'**authentification à deux facteurs** sur Supabase, GitHub et l'hébergeur.
3. Activer les **sauvegardes** (PITR si le plan le permet) et tester une restauration.
4. Choisir une **région Supabase** cohérente avec vos engagements envers les clients, et l'indiquer dans votre contrat.
5. Mettre la **clé `service_role`** uniquement dans les secrets de la fonction Edge. Jamais dans le front, ni dans un dépôt.
6. Planifier la purge: activer `pg_cron` et lancer la commande en commentaire dans `security.sql`.
7. Placer le projet derrière **Cloudflare** (ou équivalent) pour la protection DDoS: la limitation de débit en base ne protège pas contre un déluge de requêtes.
8. Consulter le journal d'audit chaque semaine (onglet « Journal d'audit » de `/admin`, ou `select * from audit_log order by id desc limit 100;`).
9. Réglages Supabase Auth: **désactiver « Allow new users to sign up »**, activer le **MFA TOTP**, raccourcir la durée du code email, et ajouter `{{ .Token }}` au modèle d'email « Magic Link » (sinon l'email ne contient qu'un lien, pas le code).
10. Créer chaque compte à la main (Authentication, Users, Add user), puis le rattacher à son organisation depuis `/admin`.

## 4. Contrat et conformité (à valider avec un juriste)

- **Contrat de sous-traitance** avec chaque client: vous traitez des données pour son compte (finalité, durée, sécurité, sous-traitants ultérieurs: Supabase, hébergeur, Cloudflare).
- **Information des visiteurs**: le client doit mentionner BEM dans sa politique de confidentialité.
- **Bannière de consentement** sur le site du client, branchée sur `BEM.consent(true|false)`. La preuve du consentement est gardée par la bannière du client; BEM ne conserve que l'indicateur `consent: true` envoyé avec l'événement.
- **Formalités CNDP**: vérifiez avec la CNDP si une déclaration ou une autorisation vous incombe et incombe à vos clients.
- Aucune donnée de démonstration en base de production (`organizations.is_demo` sert à les repérer).

## 5. Procédures

**Nouveau client**: créer l'organisation, ajouter ses domaines, vérifier la propriété du domaine (vous passez `is_verified` à true), définir les règles de perte avec lui, `attach_user_to_org`, installer le script.

**Fin de contrat**: exporter (`export_organization_data`) et remettre l'export au client, puis `erase_organization`, puis retirer le script de son site. Les sauvegardes expirent selon leur durée de vie; indiquez-la au client.

**Incident (fuite suspectée)**: 1) régénérer les clés Supabase et révoquer les sessions, 2) changer le `verification_token` des domaines concernés, 3) lire `audit_log` et les journaux Supabase pour délimiter l'impact, 4) informer les clients concernés sans délai, selon vos obligations contractuelles et légales, 5) consigner l'incident et les corrections.

**Rotation**: changer le `verification_token` d'un domaine si le script a été copié ailleurs; changer les clés Supabase si elles ont été exposées.

## 6. Limites connues

- Le token d'ingestion est public (dans le HTML du site client). La protection repose sur la vérification du domaine d'origine; un attaquant qui falsifie l'en-tête `Origin` hors navigateur peut envoyer de faux événements (limités à 600 par minute). Les données ne sont jamais lisibles par ce biais.
- Le consentement est déclaré par le navigateur. Un visiteur qui modifie le script peut en déclarer un faux; cela n'expose aucune donnée, cela fausse seulement les statistiques.
- La CSP autorise `'unsafe-inline'` (nécessaire à Next.js sans middleware de nonce). Une CSP à nonce est une amélioration possible.
- Pas de codes de secours MFA: si un utilisateur perd son téléphone, le propriétaire doit supprimer son facteur (Supabase, Authentication, Users) pour qu'il en enregistre un nouveau. Protégez surtout le compte propriétaire (deux appareils ou gestionnaire de mots de passe avec TOTP).
- Rien n'a été exécuté sur un vrai Postgres ici: testez sur un projet Supabase vide.
