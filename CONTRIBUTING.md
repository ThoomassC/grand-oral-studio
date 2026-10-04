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

Les variables de production sont dans le projet Vercel ; ne pas les recopier ailleurs.

## Publier une version

1. PR vers `develop` qui passe `package.json` à la nouvelle version (semver).
2. PR `develop` → `main`.
3. Tag annoté `vX.Y.Z` sur `main` et release GitHub.
