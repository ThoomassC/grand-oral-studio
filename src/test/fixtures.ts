import type { ProgramContext, ThemeRef } from "@/domain/contracts";
import type { Brand, Classification, DeckSpec, PromptTemplate, Slide } from "@/domain/schemas";

/**
 * Données de test partagées. Contenu volontairement générique et fictif :
 * aucune école, aucune marque réelle. Chaque fabrique renvoie un objet neuf
 * pour que les tests ne partagent jamais d'état mutable.
 */

export function makeThemes(): ThemeRef[] {
  return [
    {
      id: "theme-energie",
      name: "Transition énergétique",
      description: "Enjeux de la production et de la consommation d'énergie.",
      keywords: ["énergie", "climat", "renouvelable"],
    },
    {
      id: "theme-numerique",
      name: "Société numérique",
      description: "Effets des technologies numériques sur la vie collective.",
      keywords: ["données", "réseaux", "algorithmes"],
    },
    {
      id: "theme-ville",
      name: "Ville de demain",
      description: "Urbanisme, mobilités et qualité de vie en milieu urbain.",
      keywords: ["mobilité", "logement", "urbanisme"],
    },
  ];
}

export function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    format: "16:9",
    language: "fr",
    durationMinutes: 20,
    sections: [
      { id: "intro", title: "Introduction", guidance: "Accroche et contexte.", slides: 1 },
      { id: "problem", title: "Problématique", guidance: "Énoncer la question.", slides: 1 },
      { id: "part1", title: "Premier axe", guidance: "Constat.", slides: 2 },
      { id: "part2", title: "Second axe", guidance: "Analyse.", slides: 3 },
      { id: "conclusion", title: "Conclusion", guidance: "Réponse et ouverture.", slides: 1 },
    ],
    tone: "Clair, pédagogique et rigoureux",
    constraints: "Pas plus de cinq puces par diapositive.",
    ...overrides,
  };
}

export function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    name: "Charte d'essai",
    colors: {
      primary: "#1F4E79",
      secondary: "#5B8DB8",
      accent: "#E07A1F",
      background: "#FFFFFF",
      text: "#222222",
    },
    fonts: { heading: "Montserrat", body: "Open Sans" },
    logoDataUrl: null,
    ...overrides,
  };
}

/** Un PNG 1x1 transparent, suffisant pour vérifier qu'un logo n'est jamais recopié. */
export const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function makeProgram(overrides: Partial<ProgramContext> = {}): ProgramContext {
  return {
    name: "Programme d'essai",
    description: "Programme fictif de trois thèmes pour les tests.",
    themes: makeThemes(),
    template: makeTemplate(),
    ...overrides,
  };
}

function slide(partial: Pick<Slide, "layout" | "sectionId" | "title"> & Partial<Slide>): Slide {
  return { subtitle: "", bullets: [], notes: "", ...partial };
}

/** Deck conforme à makeTemplate() : 1 couverture + 1 + 1 + 2 + 3 + 1 = 9 diapos. */
export function makeConformingDeck(): DeckSpec {
  return {
    title: "Faut-il repenser nos mobilités",
    subtitle: "Grand oral",
    slides: [
      slide({ layout: "title", sectionId: "cover", title: "Faut-il repenser nos mobilités", subtitle: "Grand oral", notes: "Se présenter et annoncer le sujet." }),
      slide({ layout: "content", sectionId: "intro", title: "Un quotidien en mouvement", bullets: ["Trajets domicile travail", "Temps perdu"], notes: "Partir d'une situation vécue." }),
      slide({ layout: "section", sectionId: "problem", title: "La question posée", bullets: ["Comment concilier mobilité et sobriété"], notes: "Lire la problématique lentement." }),
      slide({ layout: "content", sectionId: "part1", title: "Un constat chiffré", bullets: ["Part de la voiture", "Émissions du transport"], notes: "Citer deux ordres de grandeur." }),
      slide({ layout: "two-columns", sectionId: "part1", title: "Des usages contrastés", bullets: ["Centres urbains", "Zones rurales"], notes: "Comparer les deux colonnes." }),
      slide({ layout: "content", sectionId: "part2", title: "Les leviers techniques", bullets: ["Électrification", "Covoiturage"], notes: "Nuancer chaque levier." }),
      slide({ layout: "content", sectionId: "part2", title: "Les leviers politiques", bullets: ["Tarification", "Aménagement"], notes: "Donner un exemple concret." }),
      slide({ layout: "content", sectionId: "part2", title: "Les limites", bullets: ["Coût", "Acceptabilité"], notes: "Annoncer la conclusion." }),
      slide({ layout: "conclusion", sectionId: "conclusion", title: "Vers une mobilité choisie", bullets: ["Synthèse", "Ouverture"], notes: "Conclure en une minute." }),
    ],
  };
}

export function makeClassification(candidates: Classification["candidates"]): Classification {
  return { reformulatedProblem: "Comment rendre la ville plus sobre", candidates };
}
