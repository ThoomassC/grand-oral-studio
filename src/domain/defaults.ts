import type { Brand, PromptTemplate, Section } from "./schemas";

/**
 * Valeurs par défaut d'un nouveau programme. Chaque appel renvoie un objet neuf
 * (aucun état partagé entre appelants).
 *
 * Gabarit : oral de 20 min, 13 diapos (1 couverture + 12), soit le volume
 * conseillé par suggestSlideCount(20).
 */

export function defaultSections(): Section[] {
  return [
    {
      id: "intro",
      title: "Introduction",
      guidance: "Accroche (fait, chiffre ou situation concrète), contexte et définition des termes clés.",
      slides: 1,
    },
    {
      id: "problem",
      title: "Problématique",
      guidance: "Énoncer la question de façon claire, en montrer l'enjeu et la tension.",
      slides: 1,
    },
    {
      id: "plan",
      title: "Annonce du plan",
      guidance: "Présenter les trois axes en une phrase chacun, dans l'ordre où ils seront traités.",
      slides: 1,
    },
    {
      id: "part1",
      title: "Premier axe",
      guidance: "Constat : état des lieux étayé par des données et un exemple précis.",
      slides: 3,
    },
    {
      id: "part2",
      title: "Deuxième axe",
      guidance: "Analyse : causes, mécanismes, points de vue en présence.",
      slides: 3,
    },
    {
      id: "part3",
      title: "Troisième axe",
      guidance: "Perspectives : leviers d'action, limites et conditions de réussite.",
      slides: 2,
    },
    {
      id: "conclusion",
      title: "Conclusion",
      guidance: "Réponse explicite à la problématique, synthèse des axes, ouverture.",
      slides: 1,
    },
  ];
}

export function defaultTemplate(): PromptTemplate {
  return {
    format: "16:9",
    language: "fr",
    durationMinutes: 20,
    sections: defaultSections(),
    tone: "Clair, structuré et argumenté, niveau master",
    constraints: "Au plus six puces courtes par diapo. Chaque partie s'appuie sur au moins un exemple concret.",
  };
}

/** Charte neutre : gris ardoise et bleu sobre, polices système, sans logo ni marque. */
export function defaultBrand(): Brand {
  return {
    name: "Apparence neutre",
    colors: {
      primary: "#1E3A5F",
      secondary: "#4A6A8A",
      accent: "#D9822B",
      background: "#FFFFFF",
      text: "#1F2933",
    },
    fonts: { heading: "Arial", body: "Arial" },
    logoDataUrl: null,
  };
}
