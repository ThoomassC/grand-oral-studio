/**
 * Notes de version : source unique de la page /notes-de-version et de
 * CHANGELOG.md (généré par `npm run changelog`). Les textes sont écrits pour
 * l'utilisateur de l'application, pas pour les développeurs.
 *
 * Publier une version : ajouter son entrée EN TÊTE de `RELEASES` (même numéro
 * que package.json), puis lancer `npm run changelog`.
 */

export type ReleaseSection = "added" | "changed" | "removed" | "fixed";

export const RELEASE_SECTION_LABELS: Record<ReleaseSection, string> = {
  added: "Ajouts",
  changed: "Modifications",
  removed: "Retraits",
  fixed: "Corrections",
};

/** Ordre d'affichage des groupes, sur la page comme dans CHANGELOG.md. */
export const RELEASE_SECTION_ORDER: readonly ReleaseSection[] = ["added", "changed", "removed", "fixed"];

export interface Release {
  /** Semver « X.Y.Z ». */
  version: string;
  /** « AAAA-MM-JJ » ; null = à venir (non publiée). Seule la première entrée peut être null. */
  date: string | null;
  /** Une phrase, en mots d'utilisateur. */
  summary: string;
  /** Groupes non vides seulement : un groupe sans entrée est omis. */
  changes: Partial<Record<ReleaseSection, readonly string[]>>;
}

/** De la plus récente à la plus ancienne. RELEASES[0].version === package.json "version". */
export const RELEASES: readonly Release[] = [
  {
    version: "1.1.0",
    date: "2026-10-05",
    summary: "Un parcours en trois temps, l'IA seulement le jour J.",
    changes: {
      added: [
        "La trame : le contenu type et la durée de chaque diapo, à la main ou depuis un prompt.",
        "Des notes pour chaque sujet (chiffres, exemples, sources), reprises le jour J.",
        "Le jour J sans sujet : le diaporama part de la problématique et de la trame.",
        "L'onglet Notes de version.",
      ],
      changed: [
        "Étapes renommées : Apparence, Trame, Jour J ; les thèmes deviennent les sujets.",
        "Configuration IA guidée, en deux questions : « Vérifier et activer » enregistre la clé et choisit Claude en un geste.",
        "Les imports (apparence, trame, sujets) se font sans IA.",
        "Les anciennes adresses (charte, gabarit, squelettes) mènent aux nouvelles pages.",
      ],
      removed: [
        "La génération des squelettes avant le jour J : ceux déjà créés restent dans Decks.",
        "L'import d'apparence depuis un PDF ou une image.",
      ],
    },
  },
  {
    version: "1.0.1",
    date: "2026-10-04",
    summary: "Préparation du travail à plusieurs. Rien ne change dans l'application.",
    changes: {},
  },
  {
    version: "1.0.0",
    date: "2026-10-04",
    summary: "Première version en ligne.",
    changes: {
      added: [
        "Comptes, projets, thèmes, charte et gabarit, avec imports.",
        "Squelettes, Jour J, export .pptx et prompt Canva.",
        "Rédaction gratuite, avec Claude ou avec Ollama.",
      ],
    },
  },
];
