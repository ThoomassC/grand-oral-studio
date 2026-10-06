/**
 * Colonne de la Configuration IA, partagée par la page et son squelette de chargement.
 * Entre 900 et 1536 px, la marge droite ne suffit pas aux fenêtres « i » (ChoiceInfo) :
 * la colonne réserve 18 rem à droite du contenu, où elles s'ouvrent sans le couvrir.
 * Au-delà, la page est centrée comme les autres (la marge suffit) ; en dessous, les
 * fenêtres passent sous leur bouton.
 */
export const SETTINGS_CONTAINER =
  "mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10 min-[900px]:max-w-[66rem] min-[900px]:pr-[19.5rem]! 2xl:max-w-3xl 2xl:pr-6!";
