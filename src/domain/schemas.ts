import { z } from "zod";
import { SAFE_FONTS } from "./fonts";

/**
 * Contrats du domaine. Toute donnée qui traverse une frontière (formulaire,
 * base JSON, réponse de l'IA) est validée par l'un de ces schémas.
 *
 * Les messages des champs saisis par l'utilisateur sont rédigés en français ici
 * même : ils s'affichent tels quels côté client comme côté serveur.
 */

// ---------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------

/**
 * Caractères de contrôle interdits en XML 1.0 (hors tabulation, saut de ligne
 * et retour chariot). Retirés de tous les textes avant validation.
 */
export const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

/** Texte libre : caractères de contrôle retirés puis espaces de bord supprimés. */
const text = () => z.string().overwrite(stripControlChars).trim();

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB (ex. #1F4E79).");

/** Bornes partagées avec la normalisation des réponses IA et la typographie. */
export const LIMITS = {
  deckTitle: 160,
  deckSubtitle: 240,
  slideTitle: 140,
  slideSubtitle: 200,
  bullets: 6,
  bullet: 180,
  notes: 3000,
  sectionId: 40,
  /** Lignes (sections) d'une trame : de quoi couvrir une structure de ~31 diapos à une ligne par diapo. */
  maxSections: 30,
  maxSlidesPerSection: 8,
  minSlides: 2,
  maxSlides: 60,
  reformulated: 600,
  rationale: 600,
  candidates: 10,
  /** Notes d'un sujet (chiffres, exemples, sources). Aligné sur le CHECK "Theme_notes_length". */
  subjectNotes: 4000,
  /** Problématiques candidates d'un sujet. Alignées sur le CHECK "Theme_problems_valid". */
  subjectProblems: 30,
  subjectProblemMin: 10,
  subjectProblemMax: 1500,
  /** Durée d'une ligne de trame, en secondes. */
  minSectionSeconds: 10,
  maxSectionSeconds: 5400,
} as const;

// ---------------------------------------------------------------------------
// Saisies utilisateur
// ---------------------------------------------------------------------------

/**
 * Sujet d'un projet (identifiant de code historique : « theme »). Les notes sont
 * les éléments de l'orateur, repris le jour J.
 */
export const ThemeInputSchema = z.object({
  name: text()
    .min(2, "Le nom du sujet doit faire au moins 2 caractères.")
    .max(120, "Le nom du sujet ne doit pas dépasser 120 caractères."),
  description: text().max(2000, "La description ne doit pas dépasser 2000 caractères.").default(""),
  keywords: z
    .array(
      text()
        .min(1, "Un mot-clé ne peut pas être vide.")
        .max(60, "Un mot-clé ne doit pas dépasser 60 caractères."),
    )
    .max(30, "30 mots-clés au plus.")
    .default([]),
  /** Chiffres, exemples, sources de l'utilisateur : repris le jour J. Sauts de ligne conservés. */
  notes: text()
    .max(LIMITS.subjectNotes, `Les notes ne doivent pas dépasser ${LIMITS.subjectNotes} caractères.`)
    .default(""),
  /**
   * Problématiques candidates du sujet (v1.2). FACULTATIF, sans valeur par défaut :
   * absent = [] à la création, problématiques INCHANGÉES à la mise à jour. Une valeur
   * par défaut [] ferait effacer les problématiques par tout formulaire antérieur à la
   * 1.2 qui ne les renvoie pas.
   */
  problems: z
    .array(
      // Longueur en points de code, comme char_length() dans le CHECK (un émoji compte pour un).
      text()
        .refine((v) => Array.from(v).length >= LIMITS.subjectProblemMin, {
          message: `Une problématique doit faire au moins ${LIMITS.subjectProblemMin} caractères.`,
        })
        .refine((v) => Array.from(v).length <= LIMITS.subjectProblemMax, {
          message: `Une problématique ne doit pas dépasser ${LIMITS.subjectProblemMax} caractères.`,
        }),
    )
    .max(LIMITS.subjectProblems, `${LIMITS.subjectProblems} problématiques au plus.`)
    .optional(),
});
export type ThemeInput = z.infer<typeof ThemeInputSchema>;

/** Mot de passe d'un compte (bornes identiques à la configuration Better Auth). */
export const PasswordSchema = z
  .string()
  .min(10, "Le mot de passe doit faire au moins 10 caractères.")
  .max(128, "Le mot de passe ne doit pas dépasser 128 caractères.");

const fontSchema = z.enum(SAFE_FONTS, "Choisissez une police dans la liste proposée.");

export const BrandSchema = z.object({
  name: text()
    .min(1, "Donnez un nom à l'apparence.")
    .max(80, "Le nom de l'apparence ne doit pas dépasser 80 caractères."),
  colors: z.object({
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    background: hexColor,
    text: hexColor,
  }),
  fonts: z.object({
    heading: fontSchema,
    body: fontSchema,
  }),
  /** Logo en data URL PNG/JPEG/SVG, 500 Ko max une fois encodé. */
  logoDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "Le logo doit être une image PNG ou JPEG.")
    .max(700_000, "Le logo ne doit pas dépasser 500 Ko.")
    .nullable()
    .default(null),
});
export type Brand = z.infer<typeof BrandSchema>;

/**
 * Une ligne de la trame (identifiant de code historique : « section ») : un titre,
 * un nombre de diapos, leur contenu type et, facultativement, leur durée.
 */
export const SectionSchema = z.object({
  id: z
    .string()
    .min(1, "L'identifiant de ligne est obligatoire.")
    .max(LIMITS.sectionId, "L'identifiant de ligne ne doit pas dépasser 40 caractères."),
  title: text()
    .min(1, "Donnez un titre à la ligne.")
    .max(80, "Le titre ne doit pas dépasser 80 caractères."),
  /** Contenu type : ce que disent les diapos de cette ligne (ancienne « consigne »). Clé JSON inchangée. */
  guidance: text().max(600, "Le contenu type ne doit pas dépasser 600 caractères.").default(""),
  slides: z
    .number("Indiquez un nombre de diapos.")
    .int("Le nombre de diapos doit être entier.")
    .min(1, "Une ligne compte au moins 1 diapo.")
    .max(LIMITS.maxSlidesPerSection, `Une ligne compte au plus ${LIMITS.maxSlidesPerSection} diapos.`),
  /**
   * Durée de la ligne en secondes ; absente = part égale du temps restant. Absente des
   * JSON v1.0 : `.optional()` (et non `.nullable()`) pour qu'un ancien gabarit relu puis
   * réenregistré ressorte sans la clé.
   */
  seconds: z
    .number("Indiquez une durée.")
    .int("La durée doit être un nombre entier de secondes.")
    .min(LIMITS.minSectionSeconds, "Une ligne dure au moins 10 secondes.")
    .max(LIMITS.maxSectionSeconds, "Une ligne dure au plus 90 minutes.")
    .optional(),
});
export type Section = z.infer<typeof SectionSchema>;

export const MAX_TEMPLATE_SLIDES = LIMITS.maxSlides;

export const PromptTemplateSchema = z
  .object({
    format: z.enum(["16:9", "4:3"], "Format attendu : 16:9 ou 4:3."),
    language: z.enum(["fr", "en"], "Langue attendue : fr ou en."),
    durationMinutes: z
      .number("Indiquez une durée en minutes.")
      .int("La durée doit être un nombre entier de minutes.")
      .min(3, "L'oral dure au moins 3 minutes.")
      .max(90, "L'oral dure au plus 90 minutes."),
    sections: z
      .array(SectionSchema)
      .min(1, "La trame compte au moins une ligne.")
      .max(LIMITS.maxSections, `La trame compte au plus ${LIMITS.maxSections} lignes.`),
    tone: text().max(200, "Le ton ne doit pas dépasser 200 caractères.").default(""),
    constraints: text().max(2000, "Les contraintes ne doivent pas dépasser 2000 caractères.").default(""),
  })
  .refine((t) => 1 + t.sections.reduce((sum, s) => sum + s.slides, 0) <= MAX_TEMPLATE_SLIDES, {
    message: "La trame dépasse 60 diapos : réduisez le nombre de diapos par ligne.",
    path: ["sections"],
  })
  // Les durées saisies tiennent dans l'oral, couverture comprise (même calcul que templateTimings).
  .refine(
    (t) => {
      const fixed = t.sections.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
      if (fixed === 0) return true;
      const total = t.durationMinutes * 60;
      const slides = 1 + t.sections.reduce((sum, s) => sum + s.slides, 0);
      const cover = Math.min(30, total / slides);
      return fixed <= total - cover;
    },
    {
      message: "La durée des lignes dépasse celle de l'oral : réduisez les durées ou allongez l'oral.",
      path: ["sections"],
    },
  )
  // Les lignes sans durée se partagent le reste : il leur faut au moins 10 s par diapo (sinon minutage 0:00).
  .refine(
    (t) => {
      const fixed = t.sections.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
      const freeSlides = t.sections.reduce((sum, s) => sum + (s.seconds === undefined ? s.slides : 0), 0);
      if (fixed === 0 || freeSlides === 0) return true;
      const total = t.durationMinutes * 60;
      const slides = 1 + t.sections.reduce((sum, s) => sum + s.slides, 0);
      const cover = Math.min(30, total / slides);
      return fixed + freeSlides * LIMITS.minSectionSeconds <= total - cover;
    },
    {
      message:
        "Les lignes sans durée n'ont plus assez de temps (10 s par diapo au moins) : réduisez les durées fixées ou allongez l'oral.",
      path: ["sections"],
    },
  );
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export const SlideLayoutSchema = z.enum(["title", "section", "content", "two-columns", "conclusion"]);
export type SlideLayout = z.infer<typeof SlideLayoutSchema>;

export const SlideSchema = z.object({
  layout: SlideLayoutSchema,
  /** Identifiant de la ligne de la trame dont la diapo est issue ("cover" pour la couverture). */
  sectionId: z.string().min(1).max(LIMITS.sectionId),
  title: text()
    .min(1, "Le titre de la diapo est obligatoire.")
    .max(LIMITS.slideTitle, "Le titre de la diapo ne doit pas dépasser 140 caractères."),
  subtitle: text().max(LIMITS.slideSubtitle, "Le sous-titre ne doit pas dépasser 200 caractères.").default(""),
  bullets: z
    .array(
      text()
        .min(1, "Une puce ne peut pas être vide.")
        .max(LIMITS.bullet, "Une puce ne doit pas dépasser 180 caractères."),
    )
    .max(LIMITS.bullets, "Six puces au plus par diapo.")
    .default([]),
  notes: text().max(LIMITS.notes, "Les notes ne doivent pas dépasser 3000 caractères.").default(""),
});
export type Slide = z.infer<typeof SlideSchema>;

export const DeckSpecSchema = z.object({
  title: text()
    .min(1, "Le titre du diaporama est obligatoire.")
    .max(LIMITS.deckTitle, "Le titre du diaporama ne doit pas dépasser 160 caractères."),
  subtitle: text().max(LIMITS.deckSubtitle, "Le sous-titre ne doit pas dépasser 240 caractères.").default(""),
  slides: z.array(SlideSchema).min(LIMITS.minSlides).max(LIMITS.maxSlides),
});
export type DeckSpec = z.infer<typeof DeckSpecSchema>;

/** Réponse brute de l'IA pour la reconnaissance du sujet. */
export const ClassificationSchema = z.object({
  reformulatedProblem: text().min(1).max(LIMITS.reformulated),
  candidates: z
    .array(
      z.object({
        themeId: z.string().min(1),
        confidence: z.number(),
        rationale: text().max(LIMITS.rationale),
      }),
    )
    .min(1)
    .max(LIMITS.candidates),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const ProblemInputSchema = z.object({
  problem: text()
    .min(10, "La problématique doit faire au moins 10 caractères.")
    .max(1500, "La problématique ne doit pas dépasser 1500 caractères."),
  /** Sujet annoncé avec la problématique, s'il y en a un. */
  hintedThemeId: z.string().min(1).nullable().default(null),
});
export type ProblemInput = z.infer<typeof ProblemInputSchema>;
