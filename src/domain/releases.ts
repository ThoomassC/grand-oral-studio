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
    version: "1.2.0",
    date: "2026-10-07",
    summary: "Plus de choix pour la rédaction, un jour J fiable, l'entraînement et le travail à plusieurs.",
    changes: {
      added: [
        "Rédaction IA : Mistral et Gemini (offres gratuites), avec votre clé, ou la clé de l'équipe quand le serveur en a une.",
        "Jour J : si la génération échoue, réessayez, changez de rédaction ou générez sans IA en un clic, sans perdre votre problématique.",
        "Un vrai chrono de préparation, qui démarre quand vous collez la problématique ; sa durée se règle dans la trame.",
        "Mode entraînement : tirage d'une problématique au hasard parmi celles du sujet, et liste « Avant l'examen ».",
        "Répétition d'un diaporama, diapo par diapo, chronométrée et comparée au minutage prévu.",
        "Questions probables du jury, avec « Je sais répondre » ou « À revoir ».",
        "Fiches de révision par sujet et notes d'orateur imprimables.",
        "Édition des diaporamas : régénérer, insérer, déplacer ou supprimer une diapo, dupliquer un diaporama.",
        "Partage d'un projet avec des collègues, en éditeur ou en lecteur.",
        "Bibliothèque d'équipe : publiez une apparence ou une trame, appliquez celle d'un collègue.",
        "Export et import d'un projet (.json), et un projet d'exemple pour découvrir l'application.",
        "Comptes : mot de passe oublié, vérification de l'adresse e-mail, changement de mot de passe, suppression du compte et export de vos données.",
      ],
      changed: [
        "La suppression d'un diaporama ou d'un projet s'annule pendant quelques secondes.",
        "Le jour J n'est « prêt » qu'après deux diaporamas et deux répétitions.",
        "Un seul mot par notion : « diaporama », « Sans IA », « Rédaction IA » et « vos consignes ».",
      ],
      removed: [
        "Claude n'est plus proposé dans la Rédaction IA. Si vous l'aviez choisi, il continue de rédiger jusqu'à ce que vous choisissiez une autre rédaction ; une clé déjà enregistrée reste dans « Mes connexions », où vous pouvez la supprimer.",
      ],
      fixed: [
        "Fichiers .pptx plus légers : le logo n'y est enregistré qu'une fois.",
        "Import d'apparence limité à 4 Mo, avec un message clair au-delà.",
        "Deux onglets ouverts sur le même projet : une modification n'écrase plus en silence celle de l'autre.",
        "Un projet dont l'apparence ou la trame est abîmée s'ouvre quand même, avec les valeurs par défaut.",
      ],
    },
  },
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
        "Configuration IA guidée, en deux questions : « Vérifier et activer » enregistre la clé et choisit Claude en un geste ; chaque choix est une carte qui détaille le résultat, le coût et les données.",
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
