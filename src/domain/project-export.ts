import { z } from "zod";
import { BRAND_FILE_MAX_BYTES } from "./import/limits";
import { BrandSchema, DeckSpecSchema, PromptTemplateSchema, stripControlChars, ThemeInputSchema } from "./schemas";

/**
 * Format d'export/import d'un projet (fichier JSON versionné) — fonctions pures.
 *
 * Le fichier ne contient JAMAIS d'identifiant interne (projet, sujet, deck), de
 * propriétaire, de membre, de clé ni de jeton : seulement le contenu rédigé par
 * l'utilisateur. Les diaporamas sont rattachés à leur sujet par son NOM ; les
 * squelettes (v1.0) et la corbeille ne sont pas exportés.
 *
 * Lecture stricte : enveloppe (format, version) contrôlée d'abord, pour un message
 * clair sur un fichier étranger ou d'une version plus récente ; puis le contenu
 * est revalidé par les schémas du domaine (Brand, PromptTemplate, ThemeInput,
 * DeckSpec). Toute clé inconnue est écartée par zod.
 */

export const PROJECT_EXPORT_FORMAT = "grand-oral-studio/projet";
export const PROJECT_EXPORT_VERSION = 1;

/**
 * Taille maximale d'un fichier de projet importé : celle des imports d'apparence
 * (4 Mo, cf. ./import/limits.ts), sous la coupure des hébergeurs (4,5 Mo) et le
 * corps maximal d'une Server Action (5 Mo, next.config.ts).
 */
export const PROJECT_FILE_MAX_BYTES = BRAND_FILE_MAX_BYTES;
export const PROJECT_FILE_TOO_LARGE_MESSAGE = "Le fichier dépasse 4 Mo : il ne peut pas être importé.";

/** Sujets par projet : aligné sur MAX_THEMES_PER_PROGRAM (src/server/validation.ts). */
export const PROJECT_EXPORT_MAX_THEMES = 60;
/** Diaporamas par fichier : borne l'écriture d'un import (un deck pèse jusqu'à ~250 Ko). */
export const PROJECT_EXPORT_MAX_DECKS = 200;

/** Moteurs connus (CHECK Deck_engine_known). */
export const EXPORT_DECK_ENGINES = ["claude", "mistral", "gemini", "openai", "ollama", "free", "mock"] as const;

const text = () => z.string().overwrite(stripControlChars).trim();

/** Sujet exporté : ThemeInputSchema, problématiques toujours présentes ([] si absentes). */
export const ExportedThemeSchema = ThemeInputSchema.extend({
  problems: ThemeInputSchema.shape.problems.unwrap().default([]),
});

export const ExportedDeckSchema = z.object({
  /** Nom du sujet de rattachement (présent dans `themes`), ou null : deck sans sujet. */
  themeName: text().min(1).max(120).nullable(),
  /** Entraînement (true) ou jour J (false). */
  practice: z.boolean(),
  /** Problématique du jour J (CHECK Deck_problem_matches_kind : 1..1500). */
  problem: text()
    .min(1, "La problématique est obligatoire.")
    .max(1500, "La problématique ne doit pas dépasser 1500 caractères."),
  spec: DeckSpecSchema,
  engine: z.enum(EXPORT_DECK_ENGINES).nullable(),
  /** ISO 8601. */
  createdAt: z.iso.datetime({ offset: true }),
});

export const ExportedProjectSchema = z
  .object({
    name: text()
      .min(1, "Le nom du projet est obligatoire.")
      .max(120, "Le nom du projet ne doit pas dépasser 120 caractères."),
    description: text().max(2000, "La description ne doit pas dépasser 2000 caractères.").default(""),
    brand: BrandSchema,
    template: PromptTemplateSchema,
    themes: z
      .array(ExportedThemeSchema)
      .max(PROJECT_EXPORT_MAX_THEMES, `${PROJECT_EXPORT_MAX_THEMES} sujets au plus.`)
      .default([]),
    decks: z
      .array(ExportedDeckSchema)
      .max(PROJECT_EXPORT_MAX_DECKS, `${PROJECT_EXPORT_MAX_DECKS} diaporamas au plus.`)
      .default([]),
  })
  .superRefine((project, ctx) => {
    const names = new Set(project.themes.map((t) => t.name));
    project.decks.forEach((deck, index) => {
      if (deck.themeName !== null && !names.has(deck.themeName)) {
        ctx.addIssue({
          code: "custom",
          path: ["decks", index, "themeName"],
          message: "Ce diaporama est rattaché à un sujet absent du fichier.",
        });
      }
    });
  });

export const ProjectExportSchema = z.object({
  format: z.literal(PROJECT_EXPORT_FORMAT),
  version: z.literal(PROJECT_EXPORT_VERSION),
  exportedAt: z.iso.datetime({ offset: true }),
  project: ExportedProjectSchema,
});

export type ExportedTheme = z.output<typeof ExportedThemeSchema>;
export type ExportedDeck = z.output<typeof ExportedDeckSchema>;
export type ExportedProject = z.output<typeof ExportedProjectSchema>;
export type ProjectExport = z.output<typeof ProjectExportSchema>;

/**
 * Construit le fichier d'export. L'entrée vient de la base (déjà validée à la
 * lecture) : un échec ici est une panne (ZodError levée), pas une erreur utilisateur.
 * Seuls les champs du format sont recopiés (les clés en trop sont écartées).
 */
export function buildProjectExport(project: z.input<typeof ExportedProjectSchema>, exportedAt: Date): ProjectExport {
  return ProjectExportSchema.parse({
    format: PROJECT_EXPORT_FORMAT,
    version: PROJECT_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    project,
  });
}

/** Texte du fichier téléchargé (indenté : lisible et comparable). */
export function serializeProjectExport(value: ProjectExport): string {
  return JSON.stringify(value, null, 2);
}

export type ParseProjectExportResult =
  | { ok: true; project: ExportedProject }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const EnvelopeSchema = z.object({ format: z.unknown(), version: z.unknown() });

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Lit un fichier de projet. Jamais d'exception : un résultat `ok: false` porte un
 * message affichable (français) et, pour un contenu invalide, les champs en cause.
 * Le message ne recopie jamais le contenu du fichier.
 */
export function parseProjectExport(raw: string): ParseProjectExportResult {
  // Une chaîne de plus de N unités UTF-16 pèse au moins N octets : refus sans encoder.
  if (raw.length > PROJECT_FILE_MAX_BYTES || byteLength(raw) > PROJECT_FILE_MAX_BYTES) {
    return { ok: false, message: PROJECT_FILE_TOO_LARGE_MESSAGE };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, message: "Le fichier n'est pas un JSON lisible." };
  }
  const envelope = EnvelopeSchema.safeParse(json);
  if (!envelope.success || envelope.data.format !== PROJECT_EXPORT_FORMAT) {
    return { ok: false, message: "Ce fichier n'est pas un export de projet Grand Oral Studio." };
  }
  const { version } = envelope.data;
  if (version !== PROJECT_EXPORT_VERSION) {
    return {
      ok: false,
      message:
        typeof version === "number" && Number.isInteger(version) && version > PROJECT_EXPORT_VERSION
          ? "Ce fichier vient d'une version plus récente de Grand Oral Studio : il ne peut pas être importé ici."
          : "La version de ce fichier d'export est inconnue.",
    };
  }
  const parsed = ProjectExportSchema.safeParse(json);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues.slice(0, 50)) {
      const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, message: "Le contenu du fichier est invalide : il ne peut pas être importé.", fieldErrors };
  }
  return { ok: true, project: parsed.data.project };
}
