# Grand Oral Studio

Prépare un grand oral à plusieurs thèmes : un diaporama squelette par thème avant le jour J, puis, à partir de la problématique tirée au sort, reconnaissance du thème et génération du diaporama complet avec notes d'orateur. Export `.pptx`, import dans Canva ou prompt prêt à coller dans l'IA de Canva.

L'app est générique : thèmes, charte graphique et gabarit de prompt sont des données propres à chaque programme.

## Parcours

1. **Thèmes** : saisie ou import en masse (`Nom | description | mot1, mot2`).
2. **Charte** : couleurs, polices, logo PNG/JPEG, aperçu fidèle au `.pptx`.
3. **Gabarit** : format, langue, durée, sections et nombre de diapos par section, ton, contraintes.
4. **Squelettes** : un diaporama générique par thème, à relire et compléter.
5. **Jour J** : problématique → 3 thèmes proposés avec confiance → choix → diaporama complet.
6. **Decks** : relecture, édition des diapos, `.pptx`, import dans Canva.

## Démarrer en local

Prérequis : Node 20+, PostgreSQL 15+.

```bash
cp .env.example .env          # puis compléter DATABASE_URL et BETTER_AUTH_SECRET
createdb grand_oral_dev
createdb grand_oral_test
npm install                   # génère aussi le client Prisma
npm run db:migrate
npm run dev
```

Sans `ANTHROPIC_API_KEY`, l'IA est simulée (`AI_PROVIDER=mock`) : le parcours complet fonctionne, avec des contenus factices. Pour de vrais contenus, renseigner `ANTHROPIC_API_KEY` et `AI_PROVIDER=anthropic`.

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
- Une page introuvable sous `/programmes/...` répond 200 (affichage correct) à cause du streaming de `loading.tsx`.
