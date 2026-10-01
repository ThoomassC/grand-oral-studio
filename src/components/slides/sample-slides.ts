import type { SlidePreviewData } from "./SlidePreview";

/** Diapos d'exemple pour l'aperçu de la charte (contenu générique). */
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
      bullets: ["Une idée par puce, formulée simplement", "Un chiffre clé et sa source", "Un exemple concret"],
    },
  },
  {
    label: "Conclusion",
    slide: {
      layout: "conclusion",
      title: "Conclusion",
      bullets: ["Réponse à la problématique", "Ouverture"],
    },
  },
];
