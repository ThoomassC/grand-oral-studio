# Direction visuelle de Grand Oral Studio

Référence : [Eco Pulse — Website Animation, Zajno](https://dribbble.com/shots/27176050-Website-Animation-for-a-Smart-Water-Bottle-Product).

La même direction s’applique à l’accueil, aux pages de compte et au studio : gris bleutés, encre profonde, grandes respirations, panneaux simples et aperçu du diaporama au centre de l’attention. Les titres éditoriaux utilisent Georgia ; les formulaires et leurs explications gardent Chivo, déjà fourni par Opale.

## Construire un écran

- Utiliser les jetons de `src/app/studio.css`, reliés aux rôles publics d’Opale. Les palettes claire et sombre doivent couvrir les mêmes rôles. Réserver les couleurs de succès, d’erreur et d’avertissement à leurs états.
- Utiliser `PageHeading` et `studio-container` pour le titre, l’introduction et les actions. Dans un projet, le titre du projet reste le h1 et celui de l’étape est un h2.
- Utiliser les composants Opale existants pour les champs, boutons, messages et dialogues. Garder des cibles d’au moins 44 px et un focus clavier visible.
- Utiliser `studio-editor-panel` et `studio-preview-panel` pour séparer les réglages de leur aperçu. Les miniatures continuent à utiliser `SlidePreview`, avec les couleurs et les polices du projet : la palette de l’interface ne modifie pas les exports.
- Vérifier le mobile, les deux thèmes et la taille de texte agrandie. Le défilement horizontal appartient aux zones qui le demandent (trame, tableaux), jamais à la page entière.

## Mouvement

`ContentMotion` accompagne l’arrivée d’une page pendant 440 ms, sans ajouter d’attente ni remonter ses composants. Les formulaires, les brouillons et la garde des modifications restent en place. Le premier focus annule le déplacement.

Les scènes de l’accueil et de la connexion ont leurs propres mouvements finis : apparition de la composition, profondeur des diapos, puis notes d’orateur. Les sections de l’accueil se révèlent au défilement ; elles sont immédiatement visibles sans JavaScript.

Respecter à la fois `prefers-reduced-motion` et le réglage du site. Un changement de préférence doit interrompre le mouvement en cours. Ne pas animer les champs pendant la saisie, ne pas déplacer les contrôles focalisés et ne pas faire attendre l’utilisateur pour jouer une transition.
