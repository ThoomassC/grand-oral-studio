import type { SlidePreviewData } from "./SlidePreview";

/** Diapos d'exemple pour l'aperçu de la charte (contenu générique), une par layout. */
export const SAMPLE_SLIDES: { label: string; slide: SlidePreviewData }[] = [
  {
    label: "Titre",
    slide: { layout: "title", title: "Titre de la présentation", subtitle: "Sous-titre ou thème" },
  },
  {
    label: "Section",
    slide: { layout: "section", title: "Premier axe", subtitle: "Constat et état des lieux" },
  },
  {
    label: "Contenu",
    slide: {
      layout: "content",
      title: "Un titre de diapositive",
      subtitle: "Un sous-titre en italique",
      bullets: ["Une idée par puce, formulée simplement", "Un chiffre clé et sa source", "Un exemple concret"],
    },
  },
  {
    label: "Deux colonnes",
    slide: {
      layout: "two-columns",
      title: "Avantages et limites",
      bullets: ["Premier avantage", "Second avantage", "Première limite", "Seconde limite"],
    },
  },
  {
    label: "Conclusion",
    slide: {
      layout: "conclusion",
      title: "Conclusion",
      bullets: ["Réponse à la problématique", "Synthèse des axes", "Ouverture"],
    },
  },
];
