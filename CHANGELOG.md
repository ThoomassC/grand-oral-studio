# Notes de version

<!-- Généré par `npm run changelog` depuis src/domain/releases.ts : ne pas modifier à la main. -->

## 1.1.0 — 5 octobre 2026

Un parcours en trois temps, l'IA seulement le jour J.

### Ajouts

- La trame : le contenu type et la durée de chaque diapo, à la main ou depuis un prompt.
- Des notes pour chaque sujet (chiffres, exemples, sources), reprises le jour J.
- Le jour J sans sujet : le diaporama part de la problématique et de la trame.
- L'onglet Notes de version.

### Modifications

- Étapes renommées : Apparence, Trame, Jour J ; les thèmes deviennent les sujets.
- Configuration IA guidée, en deux questions : « Vérifier et activer » enregistre la clé et choisit Claude en un geste.
- Les imports (apparence, trame, sujets) se font sans IA.
- Les anciennes adresses (charte, gabarit, squelettes) mènent aux nouvelles pages.

### Retraits

- La génération des squelettes avant le jour J : ceux déjà créés restent dans Decks.
- L'import d'apparence depuis un PDF ou une image.

## 1.0.1 — 4 octobre 2026

Préparation du travail à plusieurs. Rien ne change dans l'application.

## 1.0.0 — 4 octobre 2026

Première version en ligne.

### Ajouts

- Comptes, projets, thèmes, charte et gabarit, avec imports.
- Squelettes, Jour J, export .pptx et prompt Canva.
- Rédaction gratuite, avec Claude ou avec Ollama.
