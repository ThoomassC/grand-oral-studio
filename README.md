# Grand Oral Studio

Prépare un grand oral, avec ou sans sujets imposés. Avant le jour J, on choisit l'apparence des diapos et on écrit leur contenu type, sans IA. Le jour J, on saisit la problématique tirée au sort : l'app reconnaît le sujet et rédige le diaporama complet avec notes d'orateur. Export `.pptx`, import dans Canva ou prompt prêt à coller dans l'IA de Canva.

L'app est générique : apparence, trame et sujets sont des données propres à chaque projet. L'IA n'intervient qu'au jour J.

En ligne : https://grand-oral-studio.vercel.app. Pour participer : [CONTRIBUTING.md](CONTRIBUTING.md).

## Parcours

1. **Apparence** : couleurs, polices, logo PNG/JPEG, aperçu fidèle au `.pptx`. À la main, depuis un prompt ou depuis un `.pptx`/`.potx`/`.thmx` d'exemple.
2. **Trame** : format, langue, durée de l'oral, puis une ligne par groupe de diapos (titre, nombre de diapos, contenu type, durée facultative). À la main ou depuis un prompt Markdown (tableau `Diapo | Titre | Contenu | Durée`, plages « 2-3 »), lu sans IA.
   **Sujets** (facultatif, onglet de la Trame) : nom, description, mots-clés et notes (chiffres, exemples, sources). Saisie ou import en masse (`Nom | description | mot1, mot2 | notes`).
3. **Jour J** : problématique → sujet reconnu (aucun sujet : étape sautée ; un seul : présélectionné ; option « Sans sujet ») → diaporama complet rédigé à partir de la trame et des notes du sujet.
4. **Decks** : relecture, édition des diapos, `.pptx`, import dans Canva. Les squelettes produits par la v1.0 y restent consultables.

Notes de version : page `/notes-de-version` (publique), générée avec `CHANGELOG.md` depuis `src/domain/releases.ts`.

## Démarrer en local

Prérequis : Node 20+, PostgreSQL 15+.

```bash
npm install
npm run setup                 # .env complété (secrets générés), bases dev/test créées, migrations appliquées
npm run dev
```

`npm run setup` ne remplace jamais une valeur déjà présente dans `.env` : on peut le relancer sans risque. Les variables facultatives (Google, clé Anthropic, Ollama) sont documentées dans [`.env.example`](.env.example).

Sans aucune clé, le moteur gratuit (sans IA) rédige des trames à compléter : le parcours complet fonctionne. `AI_PROVIDER=mock` (dev/tests) remplace la clé serveur par un mock déterministe. Voir « Moteurs de rédaction ».

## Moteurs de rédaction

Chaque utilisateur choisit dans la **Configuration IA** qui rédige le jour J :

| Moteur | Coût | Qualité | Prérequis |
|---|---|---|---|
| **Sans IA** | aucun, instantané, sans réseau | trame remplie avec les notes du sujet, à compléter (« Construit sans IA ») | aucun |
| **Claude** | crédits Anthropic de l'utilisateur (ou du serveur) | contenu rédigé | une clé API (voir « Clé API ») |
| **Ollama** | calcul local | dépend du modèle ; lent | Ollama sur le serveur |

Sans préférence enregistrée : Claude si une clé existe (la sienne, sinon `ANTHROPIC_API_KEY`), sinon le moteur gratuit, y compris en production. Si le moteur choisi n'est plus disponible (clé supprimée, Ollama arrêté), la génération échoue avec un message qui renvoie vers la Configuration IA : aucune bascule silencieuse. Exception le jour J : la **reconnaissance du sujet** se replie toujours sur la version sans IA si l'IA échoue, et l'indique.

Chaque deck garde la trace du moteur qui l'a produit (`engine` : `claude`, `ollama`, `free`, `mock`, ou `null` pour les decks antérieurs).

### Ollama

```bash
brew install ollama          # ou https://ollama.com/download
ollama serve                 # écoute sur http://localhost:11434
ollama pull mistral          # au moins un modèle
```

Puis dans `.env` : `OLLAMA_BASE_URL=http://localhost:11434`, et redémarrer `npm run dev`. L'utilisateur choisit ensuite un modèle parmi ceux installés (`GET /api/tags`) ; l'URL n'est jamais saisie par l'utilisateur (protection SSRF). Ne pas mettre `AI_PROVIDER=ollama` : le serveur refuse de démarrer (seules valeurs : `anthropic`, `mock`).

Limites : délai `AI_OLLAMA_TIMEOUT_MS` pour un deck (défaut 10 min) et `AI_OLLAMA_CLASSIFY_TIMEOUT_MS` pour la reconnaissance (défaut 45 s, puis repli sans IA) ; `AI_OLLAMA_MAX_CONCURRENCY` appels simultanés par instance (défaut 2, puis « Le modèle local est occupé ») ; quotas `AI_QUOTA_PER_HOUR_OLLAMA` (80/h par utilisateur) et `AI_OLLAMA_GLOBAL_HOURLY_LIMIT` (200/h au total) ; réponse bornée à 2 Mo. Un appel qui n'a pas pu joindre Ollama ne consomme pas de quota.

**En production, Ollama doit tourner sur le serveur (ou un hôte interne joignable par lui), pas sur le poste de l'utilisateur** : c'est le serveur qui l'appelle. Un petit modèle sur CPU peut dépasser le délai pour un deck complet ; préférer un GPU ou un modèle léger.

## Clé API

Chaque utilisateur peut enregistrer **sa** clé API Anthropic dans la **Configuration IA** (`/configuration-ia`). Ses générations du jour J (reconnaissance du sujet, deck final) l'utilisent alors. « Vérifier et activer » contrôle la clé, l'enregistre chiffrée et choisit Claude en une seule opération. Ordre de résolution :

1. la clé de l'utilisateur ;
2. la clé du serveur `ANTHROPIC_API_KEY` (sauf `AI_PROVIDER=mock`) ;
3. le mode simulé, hors production uniquement ;
4. sinon : « Ajoutez votre clé API Anthropic dans la Configuration IA pour lancer une génération. »

Prérequis serveur : la clé maître de chiffrement, à générer une fois puis à ajouter au `.env` (redémarrer ensuite `npm run dev`) :

```bash
openssl rand -base64 32   # → SETTINGS_ENCRYPTION_KEY=...
```

- À l'enregistrement, la clé est vérifiée auprès d'Anthropic par un appel gratuit (`GET /v1/models`, aucune génération), puis stockée chiffrée (AES-256-GCM, liée à l'utilisateur). Seuls ses 4 derniers caractères sont affichés ; elle n'est jamais renvoyée au navigateur ni journalisée.
- Vérifications limitées à 10 par heure et par utilisateur, 200 par heure au total.
- La clé ne part que vers `ANTHROPIC_API_URL` (défaut `https://api.anthropic.com`) : les variables `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` et `ANTHROPIC_CUSTOM_HEADERS` de l'environnement du processus sont ignorées. Les arguments des Server Actions ne sont pas journalisés par `next dev` (`logging.serverFunctions: false`).
- Avec sa propre clé, le plafond global `AI_GLOBAL_HOURLY_LIMIT` ne s'applique pas ; le quota par utilisateur reste (`AI_QUOTA_PER_HOUR_OWN_KEY`, défaut 200/h).
- Rotation de la clé maître : voir `SETTINGS_ENCRYPTION_KEY_VERSION` et `SETTINGS_ENCRYPTION_KEY_PREVIOUS` dans `.env.example`. Perdre la clé maître rend les clés enregistrées illisibles : les utilisateurs devront les saisir à nouveau.

## Connexion avec Google

Facultative : sans les deux variables, le bouton « Continuer avec Google » n'apparaît pas.

1. Créer un projet sur https://console.cloud.google.com.
2. *API et services → Écran de consentement OAuth* : type **Externe**, laisser en mode **Test** et ajouter son adresse Google dans les **utilisateurs test**.
3. *Identifiants → Créer des identifiants → ID client OAuth*, type **Application Web** :
   - origine JavaScript autorisée : `http://localhost:3000` ;
   - URI de redirection autorisée : `http://localhost:3000/api/auth/callback/google`.
4. Copier l'ID client et le secret dans `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), puis redémarrer `npm run dev`.

Seuls les scopes `openid`, `email` et `profile` sont demandés. Un compte créé par e-mail et mot de passe ne peut pas (encore) être relié à Google : la connexion Google sur la même adresse est refusée avec un message invitant à utiliser le mot de passe. Il faudra une vérification d'e-mail à l'inscription pour activer cette liaison.

## Vérifications

| Commande | Rôle |
|---|---|
| `npm test` | tests unitaires (domaine, prompts, export, sans base) |
| `npm run db:test:migrate` puis `npm run test:int` | tests d'intégration sur `grand_oral_test` (autorisation, concurrence, génération) |
| `npx tsc --noEmit` | types |
| `npm run lint` | lint |
| `npm run build` | build de production |

## Architecture

- `src/domain/` : schémas zod et fonctions pures (prompts, classification, typographie des diapos, prompt Canva).
- `src/server/` : accès aux données avec contrôle de propriété, couche IA (Anthropic ou simulée), Server Actions, quotas.
- `src/export/pptx.ts` : génération du `.pptx` (pptxgenjs).
- `src/app/`, `src/components/` : interface (Next.js 16, App Router).

## Limites connues

- Pas de réinitialisation du mot de passe ni de vérification d'e-mail : il faut un service d'envoi d'e-mails.
- Pas d'intégration directe à l'API Canva : passage par l'import `.pptx` ou le prompt Canva.
- Une page introuvable sous `/projets/...` répond 200 (affichage correct) à cause du streaming de `loading.tsx`.
