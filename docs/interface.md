# Direction visuelle de Grand Oral Studio

Référence : [Agile Sprint Board — Lovable](https://lovable.dev/templates/apps/project-management/agile-sprint-board-template), et sa [démo publique](https://agile-board-lovable.lovable.app/).

L’accueil reprend le contraste entre une grande photo sombre, des titres sans empattements et des sections claires. La connexion utilise une photo à gauche et un formulaire compact à droite. Le studio utilise des surfaces neutres, des bordures fines et un accent indigo réservé aux actions et états de progression. Les boutons et champs sur une ligne sont en pilule, les boutons d’icône sont circulaires et les champs sur plusieurs lignes ont des coins de 16 px. Les cartes gardent leurs coins de 6 à 8 px. Inter est auto-hébergée ; les polices et couleurs choisies dans les diaporamas restent indépendantes.

## Construire un écran

- Utiliser les jetons de `src/app/studio.css`, reliés aux rôles publics d’Opale, dans les deux thèmes. Réserver les couleurs de succès, d’erreur et d’avertissement à leurs états.
- Utiliser `PageHeading` et `studio-container` pour le titre, l’introduction et les actions. Dans un projet, le titre du projet reste le h1 et celui de l’étape est un h2.
- Utiliser les composants Opale existants pour les champs, boutons, messages et dialogues. Garder des cibles d’au moins 44 px et un focus clavier visible.
- Réutiliser `--studio-control-radius`, `--studio-icon-radius` et `--studio-multiline-radius` pour les contrôles personnalisés. Leur fond, leur bordure et leur focus doivent suivre la même forme, y compris avec l’autoremplissage du navigateur.
- Utiliser `studio-editor-panel` et `studio-preview-panel` pour les réglages et leur aperçu. Les miniatures utilisent `SlidePreview`, avec les couleurs et les polices du projet.
- L’aperçu public est un projet d’exemple, explicitement identifié. Il présente le parcours existant et ne propose aucun faux contrôle interactif.
- Vérifier le mobile, les deux thèmes et le texte agrandi. Le défilement horizontal appartient aux zones qui le demandent (trame, tableaux), jamais à la page entière.

## Mouvement

`ContentMotion` accompagne l’arrivée d’une page pendant 240 ms, sans ajouter d’attente ni remonter ses composants. Les formulaires, brouillons et gardes de modifications restent en place. Le premier focus annule le déplacement.

L’accueil et le formulaire de connexion apparaissent discrètement. Les sections de l’accueil se révèlent au défilement ; elles sont immédiatement visibles sans JavaScript. La connexion et la déconnexion partagent une transition de 1 100 ms : photo de l’accueil floutée, logo blanc en légère oscillation et barre arrondie de 5 px, sans texte visible ni pourcentage fictif. La barre progresse régulièrement et se termine pendant les 260 dernières millisecondes, sans redémarrer son animation. Les messages d’état restent accessibles aux lecteurs d’écran ; le lien « Accéder à mon espace » se révèle au focus clavier.

La session est vérifiée avant d’ouvrir le studio. La déconnexion attend la confirmation du serveur, précharge l’accueil et conserve la garde des modifications non enregistrées. La modale Opale bloque les commandes du fond pendant la sortie ; en cas d’échec, elle se ferme, rend le focus au compte et annonce l’erreur. Le mouvement réduit supprime toute attente visuelle, tout en attendant la réponse réelle de déconnexion.

Respecter `prefers-reduced-motion` et le réglage du site, y compris lors d’un changement de préférence. Ne pas animer les champs pendant la saisie, déplacer les contrôles focalisés ou faire attendre pour jouer une transition.

## Assets

- Photo : **Teemu Paananen**, « Karri Saarinen presenting at Nordic Design », [Unsplash](https://unsplash.com/photos/bzdhc5b3Bxs), [licence Unsplash](https://unsplash.com/license). Fichier local `src/assets/oral-stage.webp`, distribué par le CDN officiel en WebP de 2200 px. Crédit visible sur l’accueil et la connexion. La photo illustre une conférence ; elle ne représente pas des utilisateurs de Grand Oral Studio.
- Police : **Inter 4.1**, Rasmus Andersson, [source officielle](https://github.com/rsms/inter/tree/v4.1), SIL Open Font License 1.1. La licence est conservée dans `src/assets/fonts/Inter-LICENSE.txt`, avec le fichier variable original.
- Le logo de l’application reste `BrandMark`. Aucun asset graphique de Lovable n’est redistribué.
