import { z } from "zod";
import { defaultBrand, defaultTemplate } from "./defaults";
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
 *
 * Écriture tolérante : une donnée abîmée en base ne fait jamais échouer l'export.
 * Apparence ou trame illisible → celle par défaut ; sujet ou diaporama illisible →
 * écarté, compté dans `project.skipped` (champ informatif, ignoré à l'import).
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
/** Export d'un projet plus lourd que ce que l'import accepte : refusé (413) plutôt que livré inutilisable. */
export const PROJECT_EXPORT_TOO_LARGE_MESSAGE =
  "Ce projet dépasse 4 Mo une fois exporté : il ne pourrait pas être réimporté. Supprimez des diaporamas anciens ou allégez le logo.";

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

/** Projet tel qu'écrit dans le fichier : le contenu, plus le nombre d'éléments écartés à l'export. */
export type ExportFileProject = ExportedProject & {
  /** Sujets et diaporamas illisibles en base, laissés hors du fichier (0 d'ordinaire). Ignoré à l'import. */
  skipped: number;
};

/** Fichier d'export produit (ProjectExportSchema le relit ; `project.skipped` y est écarté). */
export type ProjectExport = Omit<z.output<typeof ProjectExportSchema>, "project"> & { project: ExportFileProject };

/** Diaporama lu en base pour l'export : JSON non encore validés, `ref` pour le journal (jamais écrit). */
export interface ExportDeckSource {
  ref?: string;
  themeName: string | null;
  practice: boolean;
  problem: string | null;
  spec: unknown;
  engine: unknown;
  createdAt: string | Date;
}

/** Contenu d'un projet lu en base pour l'export (apparence, trame et diaporamas non encore validés). */
export interface ProjectExportSource {
  name: string;
  description?: string;
  brand: unknown;
  template: unknown;
  themes: z.input<typeof ExportedThemeSchema>[];
  decks: ExportDeckSource[];
}

/** Élément remplacé (apparence, trame) ou écarté (sujet : `ref` = position ; diaporama : `ref` fourni). */
export interface ExportIssue {
  item: "brand" | "template" | "theme" | "deck";
  ref?: string;
}

const PROJECT_NAME_FALLBACK = "Projet sans nom";

/** Texte normalisé comme le format (caractères de contrôle, espaces) et tenu sous `max` unités UTF-16. */
function fitText(value: string, max: number): string {
  let out = stripControlChars(value).trim();
  if (out.length <= max) return out;
  // Coupe par points de code : jamais une moitié de paire de substitution.
  const chars = Array.from(out);
  while (chars.length > 0 && chars.join("").length > max) chars.pop();
  out = chars.join("").trim();
  return out;
}

/**
 * Construit le fichier d'export à partir du contenu lu en base, sans jamais échouer
 * sur une donnée abîmée : apparence ou trame illisible → par défaut ; sujet ou
 * diaporama illisible → écarté et compté (`project.skipped`) ; un diaporama dont le
 * sujet est écarté est détaché (sans sujet) plutôt que perdu. Le fichier produit est
 * toujours relisible par parseProjectExport. `issues` dit quoi journaliser.
 */
export function assembleProjectExport(
  source: ProjectExportSource,
  exportedAt: Date,
): { data: ProjectExport; issues: ExportIssue[] } {
  const issues: ExportIssue[] = [];

  const brand = BrandSchema.safeParse(source.brand);
  if (!brand.success) issues.push({ item: "brand" });
  const template = PromptTemplateSchema.safeParse(source.template);
  if (!template.success) issues.push({ item: "template" });

  let skipped = 0;
  const themes: ExportedTheme[] = [];
  source.themes.forEach((raw, index) => {
    const theme = ExportedThemeSchema.safeParse(raw);
    if (theme.success && themes.length < PROJECT_EXPORT_MAX_THEMES) {
      themes.push(theme.data);
    } else {
      skipped += 1;
      issues.push({ item: "theme", ref: String(index) });
    }
  });
  const themeNames = new Set(themes.map((t) => t.name));

  const decks: ExportedDeck[] = [];
  for (const raw of source.decks) {
    const deck = ExportedDeckSchema.safeParse({
      // Sujet écarté (ou nom normalisé différemment) : diaporama détaché, pas perdu.
      themeName: raw.themeName !== null && themeNames.has(raw.themeName.trim()) ? raw.themeName.trim() : null,
      practice: raw.practice,
      problem: raw.problem ?? "",
      spec: raw.spec,
      engine: raw.engine,
      createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : raw.createdAt,
    });
    if (deck.success && decks.length < PROJECT_EXPORT_MAX_DECKS) {
      decks.push(deck.data);
    } else {
      skipped += 1;
      issues.push({ item: "deck", ...(raw.ref ? { ref: raw.ref } : {}) });
    }
  }

  const project = ExportedProjectSchema.parse({
    name: fitText(source.name, 120) || PROJECT_NAME_FALLBACK,
    description: fitText(source.description ?? "", 2000),
    brand: brand.success ? brand.data : defaultBrand(),
    template: template.success ? template.data : defaultTemplate(),
    themes,
    decks,
  });
  return {
    data: {
      format: PROJECT_EXPORT_FORMAT,
      version: PROJECT_EXPORT_VERSION,
      exportedAt: exportedAt.toISOString(),
      project: { ...project, skipped },
    },
    issues,
  };
}

/** Fichier d'export (cf. assembleProjectExport), sans le détail à journaliser. */
export function buildProjectExport(source: ProjectExportSource, exportedAt: Date): ProjectExport {
  return assembleProjectExport(source, exportedAt).data;
}

/**
 * Texte du fichier téléchargé : JSON compact. L'indentation gonflait le fichier
 * d'un bon tiers et le rapprochait de la limite d'import (4 Mo).
 */
export function serializeProjectExport(value: ProjectExport): string {
  return JSON.stringify(value);
}

/** Taille en octets (UTF-8) d'un texte d'export. */
export function exportByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Contenu d'un projet tel qu'écrit en base par un import (comparaison de rejeu). */
export interface ProjectContent {
  name: string;
  description: string;
  brand: unknown;
  template: unknown;
  themes: { name: string; description: string; keywords: string[]; notes: string; problems: string[] }[];
  decks: { themeName: string | null; practice: boolean; problem: string; spec: unknown; engine: string | null }[];
}

/** JSON aux clés d'objet triées : indépendant de l'ordre de construction ou de relecture (jsonb). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Forme normalisée d'un contenu de projet, à hacher (sha-256) pour reconnaître un
 * import rejoué : clés triées, sujets dans leur ordre, diaporamas sans ordre (la base
 * ne garde pas l'ordre du fichier), sans date de création (bornée à l'import).
 */
export function canonicalProjectContent(content: ProjectContent): string {
  return canonicalJson({
    name: content.name,
    description: content.description,
    brand: content.brand,
    template: content.template,
    themes: content.themes.map((t) => ({
      name: t.name,
      description: t.description,
      keywords: t.keywords,
      notes: t.notes,
      problems: t.problems,
    })),
    decks: content.decks
      .map((d) => canonicalJson({ themeName: d.themeName, practice: d.practice, problem: d.problem, spec: d.spec, engine: d.engine }))
      .sort(),
  });
}

export type ParseProjectExportResult =
  | { ok: true; project: ExportedProject }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const EnvelopeSchema = z.object({ format: z.unknown(), version: z.unknown() });

/**
 * Lit un fichier de projet. Jamais d'exception : un résultat `ok: false` porte un
 * message affichable (français) et, pour un contenu invalide, les champs en cause.
 * Le message ne recopie jamais le contenu du fichier.
 */
export function parseProjectExport(raw: string): ParseProjectExportResult {
  // Une chaîne de plus de N unités UTF-16 pèse au moins N octets : refus sans encoder.
  if (raw.length > PROJECT_FILE_MAX_BYTES || exportByteLength(raw) > PROJECT_FILE_MAX_BYTES) {
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
