# Contribuer à Grand Oral Studio

## Installer

Prérequis : Node 20+ et PostgreSQL 15+ démarré. Puis :

```bash
npm install
npm run setup     # crée et complète .env, crée les bases dev/test, applique les migrations
npm run dev
```

Chaque variable est documentée dans [`.env.example`](.env.example). **Ne jamais committer `.env` ni un secret** (clé API, mot de passe, URL de base de données réelle) : `.env*` est ignoré par git, sauf `.env.example`.

## Branches

- `main` : production. Reçoit `develop` par PR au moment d'une version, puis un tag `vX.Y.Z`.
- `develop` : branche d'intégration, branche par défaut.
- Branches de travail créées **depuis `develop`** : `feat/…`, `fix/…`, `chore/…`, `test/…`, `docs/…`.

Toute modification passe par une **Pull Request vers `develop`** : `develop` et `main` sont protégées (pas de push direct, pas de force push). Une PR ne peut être mergée qu'avec les vérifications CI `verify` et `integration` au vert.

## Commits

Conventional Commits, en français : `feat(projets): …`, `fix(ui): …`, `test(int): …`, `chore(deps): …`. Un commit = un changement cohérent.

## Avant d'ouvrir une PR

```bash
npx tsc --noEmit
npm run lint
npm test
npm run test:int     # base grand_oral_test
npm run build
```

Les tests E2E (`npm run test:e2e`, serveur de dev lancé) tournent la nuit en CI ; les lancer en local quand un parcours change. Un bug corrigé vient avec un test qui le reproduit. Les migrations Prisma déjà appliquées ne se modifient jamais : en ajouter une nouvelle.

## Déploiement

Le dépôt est connecté à Vercel :

- chaque PR et chaque branche ont un **aperçu** (URL dans la PR) ;
- un merge dans **`main`** déploie la production : https://grand-oral-studio.vercel.app ;
- les migrations Prisma sont appliquées au build (`vercel-build`).

Les variables de production sont dans le projet Vercel ; ne pas les recopier ailleurs. Les nouvelles variables d'une version (pour la 1.2.0 : `RESEND_API_KEY` et `EMAIL_FROM` ensemble ou aucune, `ALLOWED_EMAIL_DOMAINS`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `AI_GENERATION_DEADLINE_MS`) sont toutes facultatives : les ajouter dans Vercel **avant** le déploiement si on veut les fonctions correspondantes.

### Migrations sans interruption (expand → validate → code)

Un changement de schéma se livre en trois temps, jamais en une migration qui casse le code encore en ligne :

1. **expand** : tables et colonnes nouvelles, nullables ou avec défaut, contraintes `CHECK … NOT VALID` (le code de la version précédente continue de fonctionner) ;
2. **validate** : `VALIDATE CONSTRAINT` dans une migration séparée ;
3. **code** : le nouveau code, qui lit et écrit le nouveau schéma. Le « contract » (suppression des anciennes colonnes) attend la version suivante.

Sur Vercel, `vercel-build` applique les migrations dans l'ordre (`20261008090000_v120_expand` puis `20261008090100_v120_validate`) avant de construire le code : l'ordre est respecté par un seul déploiement.

**Après le déploiement de la 1.2.0**, rejouer le bloc `copy_claude_keys` de la migration expand : il recopie dans `user_ai_credential` les clés Claude enregistrées par le code 1.1 entre l'application de la migration et la mise en ligne du code 1.2. Il est idempotent (`ON CONFLICT DO NOTHING`) :

```bash
sed -n '/BEGIN copy_claude_keys/,/END copy_claude_keys/p' prisma/migrations/20261008090000_v120_expand/migration.sql \
  | { cat; echo ';'; } | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
```

À rejouer encore une fois avant le « contract » de la 1.3 (suppression des colonnes `anthropicKey*` de `user_ai_settings`).

## Publier une version

1. PR vers `develop` qui passe `package.json` à la nouvelle version (semver) et ajoute la version en tête de `src/domain/releases.ts` (date, résumé, ajouts / modifications / retraits / corrections, en mots d'utilisateur ; vocabulaire de l'interface : « diaporama », « Sans IA », « Rédaction IA », « vos consignes »). `npm version X.Y.Z --no-git-tag-version` met à jour `package.json` et `package-lock.json` sans rien installer. Puis `npm run changelog` régénère `CHANGELOG.md` : ne pas le modifier à la main, un test vérifie qu'il est à jour et que la première version est celle de `package.json`.
2. PR `develop` → `main`.
3. Tag annoté `vX.Y.Z` sur `main` et release GitHub.
