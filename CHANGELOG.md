# Notes de version

<!-- Généré par `npm run changelog` depuis src/domain/releases.ts : ne pas modifier à la main. -->

## 1.2.0 — 7 octobre 2026

Plus de choix pour la rédaction, un jour J fiable, l'entraînement et le travail à plusieurs.

### Ajouts

- Rédaction IA : Mistral et Gemini (offres gratuites), OpenAI ou Claude avec votre clé, ou la clé de l'équipe quand le serveur en a une.
- Jour J : si la génération échoue, réessayez, changez de rédaction ou générez sans IA en un clic, sans perdre votre problématique.
- Un vrai chrono de préparation, qui démarre quand vous collez la problématique ; sa durée se règle dans la trame.
- Mode entraînement : tirage d'une problématique au hasard parmi celles du sujet, et liste « Avant l'examen ».
- Répétition d'un diaporama, diapo par diapo, chronométrée et comparée au minutage prévu.
- Questions probables du jury, avec « Je sais répondre » ou « À revoir ».
- Fiches de révision par sujet et notes d'orateur imprimables.
- Édition des diaporamas : régénérer, insérer, déplacer ou supprimer une diapo, dupliquer un diaporama.
- Partage d'un projet avec des collègues, en éditeur ou en lecteur.
- Bibliothèque d'équipe : publiez une apparence ou une trame, appliquez celle d'un collègue.
- Export et import d'un projet (.json), et un projet d'exemple pour découvrir l'application.
- Comptes : mot de passe oublié, vérification de l'adresse e-mail, changement de mot de passe, suppression du compte et export de vos données.

### Modifications

- La suppression d'un diaporama ou d'un projet s'annule pendant quelques secondes.
- Le jour J n'est « prêt » qu'après deux diaporamas et deux répétitions.
- Un seul mot par notion : « diaporama », « Sans IA », « Rédaction IA » et « vos consignes ».

### Corrections

- Fichiers .pptx plus légers : le logo n'y est enregistré qu'une fois.
- Import d'apparence limité à 4 Mo, avec un message clair au-delà.
- Deux onglets ouverts sur le même projet : une modification n'écrase plus en silence celle de l'autre.
- Un projet dont l'apparence ou la trame est abîmée s'ouvre quand même, avec les valeurs par défaut.

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
