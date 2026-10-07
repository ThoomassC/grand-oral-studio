# Grand Oral Studio

Prépare un grand oral, avec ou sans sujets imposés. Avant le jour J, on choisit l'apparence des diapos et on écrit leur contenu type, sans IA. Le jour J, on saisit la problématique tirée au sort : l'app reconnaît le sujet et rédige le diaporama complet avec notes d'orateur. Export `.pptx`, import dans Canva ou consignes prêtes à coller dans l'IA de Canva. Entre les deux, on s'entraîne : diaporamas d'entraînement, répétition chronométrée, questions probables du jury.

L'app est générique : apparence, trame et sujets sont des données propres à chaque projet. L'IA n'intervient qu'au jour J.

En ligne : https://grand-oral-studio.vercel.app. Pour participer : [CONTRIBUTING.md](CONTRIBUTING.md).

## Parcours

1. **Apparence** : couleurs, polices, logo PNG/JPEG, aperçu fidèle au `.pptx`. À la main, depuis vos consignes (texte collé) ou depuis un `.pptx`/`.potx`/`.thmx` d'exemple (4 Mo au plus).
2. **Trame** : format, langue, durée de l'oral, temps de préparation (chrono du jour J, 90 min par défaut), puis une ligne par groupe de diapos (titre, nombre de diapos, contenu type, durée facultative). À la main ou depuis vos consignes en Markdown (tableau `Diapo | Titre | Contenu | Durée`, plages « 2-3 »), lues sans IA.
   **Sujets** (facultatif, onglet de la Trame) : nom, description, mots-clés, notes (chiffres, exemples, sources) et problématiques possibles. Saisie ou import en masse (`Nom | description | mot1, mot2 | notes`). Fiche de révision imprimable par sujet.
3. **Jour J** : problématique → sujet reconnu (aucun sujet : étape sautée ; un seul : présélectionné ; option « Sans sujet ») → diaporama complet rédigé à partir de la trame et des notes du sujet, dans le temps imparti (`AI_GENERATION_DEADLINE_MS`). En cas d'échec : « Réessayer », « Générer avec <autre connexion> » ou « Générer sans IA maintenant », sans bascule automatique. Le chrono de préparation démarre au collage de la problématique et survit au rechargement. Mode **entraînement** (`?mode=entrainement`) : tirage d'une problématique, diaporama marqué « entraînement » ; liste « Avant l'examen ». Le projet n'est « prêt » qu'avec deux diaporamas et deux répétitions.
4. **Diaporamas** : relecture, édition des diapos (régénérer une diapo par l'IA, insérer, déplacer, supprimer), duplication, suppression annulable quelques secondes, `.pptx`, import dans Canva. Répétition plein écran chronométrée, questions probables du jury, notes d'orateur imprimables. Les squelettes produits par la v1.0 y restent consultables.

**Partage** : le propriétaire invite des collègues (comptes existants) en **éditeur** ou en **lecteur** ; un lecteur relit, exporte, répète et imprime, sans rien modifier (Jour J compris). **Bibliothèque d'équipe** : une apparence ou une trame publiée s'applique à n'importe quel projet de l'instance. **Transfert** : export et import d'un projet en JSON (sans identifiant ni secret), projet d'exemple, export des données du compte depuis le Profil.

Notes de version : page `/notes-de-version` (publique), générée avec `CHANGELOG.md` depuis `src/domain/releases.ts`.

## Démarrer en local

Prérequis : Node 20+, PostgreSQL 15+.

```bash
npm install
npm run setup                 # .env complété (secrets générés), bases dev/test créées, migrations appliquées
npm run dev
```

`npm run setup` ne remplace jamais une valeur déjà présente dans `.env` : on peut le relancer sans risque. Les variables facultatives (Google, e-mails Resend, domaines autorisés, clés d'équipe Mistral/Gemini, Ollama, échéance de génération) sont documentées dans [`.env.example`](.env.example).

Sans aucune clé, la rédaction **Sans IA** produit des diaporamas à compléter : le parcours complet fonctionne. `AI_PROVIDER=mock` (dev/tests) fait de la carte **Démo** (contenus factices, sans clé) le choix par défaut, servi par un mock déterministe. Voir « Rédaction ».

## Rédaction

Chaque utilisateur choisit dans la **Rédaction IA** (`/configuration-ia`) qui rédige le jour J :

| Rédaction | Coût | Qualité | Prérequis |
|---|---|---|---|
| **Sans IA** | aucun, instantané, sans réseau | diaporama à compléter, construit avec la trame et les notes du sujet | aucun |
| **Mistral** | offre gratuite possible ; hébergé dans l'UE | contenu rédigé | sa clé, ou la clé de l'équipe (`MISTRAL_API_KEY`) |
| **Gemini** | offre gratuite possible | contenu rédigé | sa clé, ou la clé de l'équipe (`GEMINI_API_KEY`) |
| **Ollama** | calcul local | dépend du modèle ; lent | Ollama sur le serveur |

Chaque carte détaille l'hébergement, l'usage des données pour l'entraînement et la conservation. Une **clé de l'équipe** n'est proposée que si la variable correspondante est renseignée sur le serveur ; elle est facturée au compte de l'équipe et soumise aux quotas `AI_QUOTA_PER_HOUR` et `AI_GLOBAL_HOURLY_LIMIT`.

Claude et OpenAI ne sont plus proposés depuis la 1.2 : aucune nouvelle connexion ni sélection n'est acceptée. Une connexion existante reste listée dans « Mes connexions », avec « Supprimer » seulement ; un utilisateur qui avait explicitement choisi Claude ou OpenAI le garde (avec sa clé, ou `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) jusqu'à ce qu'il choisisse un autre rédacteur.

Sans préférence enregistrée : la démo si `AI_PROVIDER=mock`, sinon la clé de l'équipe Mistral, sinon celle de Gemini, sinon Sans IA, y compris en production (jamais une clé personnelle implicitement). Supprimer une connexion alors qu'elle rédige ramène la rédaction au choix par défaut ; un autre rédacteur choisi est conservé. Si le rédacteur choisi n'est plus disponible (clé refusée, crédit épuisé, limite du fournisseur, Ollama arrêté…), la génération échoue avec un message qui renvoie vers la Rédaction IA et propose le repli en un clic : aucune bascule silencieuse. Exception le jour J : la **reconnaissance du sujet** se replie toujours sur la version sans IA si l'IA échoue, et l'indique.

Chaque diaporama garde la trace de la rédaction qui l'a produit (`engine` : `claude`, `mistral`, `gemini`, `openai`, `ollama`, `free`, `mock`, ou `null` pour les diaporamas antérieurs).

### Ollama

```bash
brew install ollama          # ou https://ollama.com/download
ollama serve                 # écoute sur http://localhost:11434
ollama pull mistral          # au moins un modèle
```

Puis dans `.env` : `OLLAMA_BASE_URL=http://localhost:11434`, et redémarrer `npm run dev`. L'utilisateur choisit ensuite un modèle parmi ceux installés (`GET /api/tags`) ; l'URL n'est jamais saisie par l'utilisateur (protection SSRF). Ne pas mettre `AI_PROVIDER=ollama` : le serveur refuse de démarrer (seules valeurs : `anthropic`, `mock`).

Limites : délai `AI_OLLAMA_TIMEOUT_MS` pour un diaporama (défaut 10 min) et `AI_OLLAMA_CLASSIFY_TIMEOUT_MS` pour la reconnaissance (défaut 45 s, puis repli sans IA) ; `AI_OLLAMA_MAX_CONCURRENCY` appels simultanés par instance (défaut 2, puis « Le modèle local est occupé ») ; quotas `AI_QUOTA_PER_HOUR_OLLAMA` (80/h par utilisateur) et `AI_OLLAMA_GLOBAL_HOURLY_LIMIT` (200/h au total) ; réponse bornée à 2 Mo. Un appel qui n'a pas pu joindre Ollama ne consomme pas de quota.

**En production, Ollama doit tourner sur le serveur (ou un hôte interne joignable par lui), pas sur le poste de l'utilisateur** : c'est le serveur qui l'appelle. Un petit modèle sur CPU peut dépasser le délai pour un diaporama complet ; préférer un GPU ou un modèle léger.

## Clés API

Chaque utilisateur peut enregistrer **sa** clé API par fournisseur proposé (Mistral, Gemini) dans la **Rédaction IA** (`/configuration-ia`), choisir le modèle dans une liste fermée, tester la connexion et l'activer. Ses générations (reconnaissance du sujet, diaporama, régénération d'une diapo, questions du jury) l'utilisent alors. Une clé Claude ou OpenAI enregistrée avant la 1.2 reste chiffrée et utilisable par la sélection qui la désigne, jusqu'à sa suppression.

Mistral et Gemini sont appelés en `fetch` sur des URL fixes (API compatible OpenAI). Une limite du fournisseur (429) est affichée avec l'heure à laquelle réessayer et rembourse l'unité de quota interne.

Prérequis serveur : la clé maître de chiffrement, à générer une fois puis à ajouter au `.env` (redémarrer ensuite `npm run dev`) :

```bash
openssl rand -base64 32   # → SETTINGS_ENCRYPTION_KEY=...
```

- À l'enregistrement, la clé est vérifiée auprès du fournisseur par un appel gratuit (liste des modèles, aucune génération), puis stockée chiffrée (AES-256-GCM, liée à l'utilisateur et au fournisseur, table `user_ai_credential`). Seuls ses 4 derniers caractères sont affichés ; elle n'est jamais renvoyée au navigateur ni journalisée.
- Vérifications limitées à 10 par heure et par utilisateur, 200 par heure au total.
- Une clé Claude héritée ne part que vers `ANTHROPIC_API_URL` (défaut `https://api.anthropic.com`) : les variables `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` et `ANTHROPIC_CUSTOM_HEADERS` de l'environnement du processus sont ignorées. Les arguments des Server Actions ne sont pas journalisés par `next dev` (`logging.serverFunctions: false`).
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

## E-mails et inscriptions

Facultatifs : sans `RESEND_API_KEY` **et** `EMAIL_FROM` (les deux ou aucune, sinon le serveur refuse de démarrer), aucun e-mail n'est envoyé, comme en 1.1. Avec les deux (API Resend, sans dépendance) : vérification de l'adresse à l'inscription (les comptes existants non vérifiés reçoivent un lien à leur prochaine connexion), « Mot de passe oublié », notification d'invitation à un projet partagé. Les liens pointent vers `BETTER_AUTH_URL`.

`ALLOWED_EMAIL_DOMAINS` (facultatif, ex. `lycee-exemple.fr, ac-paris.fr`) limite la création de comptes à ces domaines exacts, connexion Google comprise. Attention : sans vérification d'adresse (RESEND), la restriction de domaine ne prouve pas la possession de la boîte (n'importe qui peut s'inscrire sous une adresse du domaine) ; le serveur démarre mais l'écrit dans son journal.

Partage d'un projet : avec e-mails, seul un compte à l'adresse confirmée peut être ajouté ; sans e-mails, l'adresse ne prouve pas l'identité de son titulaire, l'écran « Partage » le rappelle au propriétaire.

Profil : changer de mot de passe (compte par e-mail), supprimer son compte (les projets partagés dont on est propriétaire disparaissent aussi pour les membres, l'écran le rappelle), télécharger ses données (JSON, sans clé ni jeton).

## Vérifications

| Commande | Rôle |
|---|---|
| `npm test` | tests unitaires (domaine, prompts, export, sans base) |
| `npm run db:test:migrate` puis `npm run test:int` | tests d'intégration sur `grand_oral_test` (autorisation, concurrence, génération) |
| `npx tsc --noEmit` | types |
| `npm run lint` | lint |
| `npm run build` | build de production |

## Architecture

- `src/domain/` : schémas zod et fonctions pures (consignes envoyées à l'IA, classification, typographie et édition des diapos, répétition, questions du jury, fiches, chrono, consignes Canva).
- `src/server/` : accès aux données avec contrôle d'accès par rôle (propriétaire, éditeur, lecteur) et corbeille, couche IA (Anthropic, fournisseurs compatibles OpenAI, Ollama, ou simulée), Server Actions, quotas, e-mails (Resend).
- `src/export/pptx.ts` : génération du `.pptx` (pptxgenjs).
- `src/app/`, `src/components/` : interface (Next.js 16, App Router).

## Limites connues

- Sans `RESEND_API_KEY`/`EMAIL_FROM`, ni vérification d'adresse ni « Mot de passe oublié » (aucun e-mail ne part) : `ALLOWED_EMAIL_DOMAINS` et l'adresse d'un collègue invité ne prouvent alors pas la possession de la boîte.
- Pas d'intégration directe à l'API Canva : passage par l'import `.pptx` ou les consignes Canva.
- Le partage invite seulement des comptes existants (pas d'invitation par e-mail d'une personne sans compte) ; 20 membres au plus par projet.
- La sortie structurée `json_schema` de Gemini n'a pas été vérifiée avec une vraie clé : en cas de refus, l'adaptateur se replie sur `json_object`.
- Une page introuvable sous `/projets/...` répond 200 (affichage correct) à cause du streaming de `loading.tsx`.
