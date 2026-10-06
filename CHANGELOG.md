# Notes de version

<!-- Généré par `npm run changelog` depuis src/domain/releases.ts : ne pas modifier à la main. -->

## 1.2.0 — 6 octobre 2026

Une nouvelle apparence, inspirée des fiches bristol qu'on garde en main devant le jury.

### Ajouts

- Les blocs que vous rédigez (lignes de trame, sujets) prennent l'allure d'une fiche, avec sa marge.
- Les textes longs (contenu type, notes, problématique, notes d'orateur) sont réglés comme une fiche.
- Les « À compléter » des diaporamas sont surlignés en jaune.

### Modifications

- Nouvelles couleurs : papier, encre marine et bleu de réglure, en clair comme en sombre (ardoise).
- Nouvelles polices, choisies pour la lisibilité : Schibsted Grotesk pour les titres, Atkinson Hyperlegible Next pour le texte.
- Formes plus nettes : angles légèrement arrondis, filets fins, plus d'ombres diffuses.
- Le champ actif est mieux signalé au clavier, et les exemples des champs sont plus lisibles.

## 1.1.0 — 5 octobre 2026

Un parcours en trois temps, l'IA seulement le jour J.

### Ajouts

- La trame : le contenu type et la durée de chaque diapo, à la main ou depuis un prompt.
- Des notes pour chaque sujet (chiffres, exemples, sources), reprises le jour J.
- Le jour J sans sujet : le diaporama part de la problématique et de la trame.
- L'onglet Notes de version.

### Modifications

- Étapes renommées : Apparence, Trame, Jour J ; les thèmes deviennent les sujets.
- Configuration IA guidée, en deux questions : « Vérifier et activer » enregistre la clé et choisit Claude en un geste ; chaque choix est une carte qui détaille le résultat, le coût et les données.
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
