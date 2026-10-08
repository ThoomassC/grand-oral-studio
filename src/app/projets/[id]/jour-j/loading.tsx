// Squelette commun des pages du projet, posé par dossier et non sur [id] : la fiche
// de révision (sujets/…) reste hors de toute frontière de chargement pour que son
// notFound() réponde un vrai 404 avant le début du streaming.
export { default } from "../../_lib/ProjectPageLoading";
