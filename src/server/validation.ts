import { z } from "zod";
import { CloudProviderSchema, KeySourceSchema } from "@/domain/ai-providers";
import { MAX_PREP_STATE_AGE_MS } from "@/domain/prep-clock";
import { stripControlChars, ThemeInputSchema } from "@/domain/schemas";
import { DataIntegrityError, ValidationError } from "./errors";

// Messages d'erreur zod en français pour tout le serveur.
z.config(z.locales.fr());

/** Convertit les issues zod en `fieldErrors` (clé = chemin pointé, "_form" pour la racine). */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Valide une entrée externe (argument d'action, paramètre de route).
 * Lève une `ValidationError` (4xx) — jamais une ZodError brute.
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError("Certaines valeurs sont invalides : corrigez les champs signalés.", toFieldErrors(result.error));
  }
  return result.data;
}

/**
 * Valide une donnée JSON lue en base. Un échec est une PANNE (donnée corrompue
 * ou migration oubliée), pas une erreur utilisateur.
 */
export function parseStored<S extends z.ZodType>(
  schema: S,
  value: unknown,
  entity: string,
  entityId: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DataIntegrityError(entity, entityId, z.prettifyError(result.error));
  }
  return result.data;
}

/**
 * Valide une valeur avant écriture en base (défense en profondeur : l'appelant
 * l'a déjà validée, mais une valeur construite par le code — domaine, IA — passe
 * aussi par ici). Un échec est une PANNE : c'est le code serveur qui a produit
 * une valeur hors contrat.
 */
export function assertWritable<S extends z.ZodType>(schema: S, value: unknown, entity: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DataIntegrityError(entity, "(écriture)", z.prettifyError(result.error));
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Schémas d'entrée propres au serveur (le reste vient de src/domain/schemas.ts)
// ---------------------------------------------------------------------------

/** Identifiant opaque (cuid ou id Better Auth). */
export const IdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identifiant invalide");

export const ProgramMetaSchema = z.object({
  name: z
    .string()
    .overwrite(stripControlChars)
    .trim()
    .min(2, "Le nom du projet doit faire au moins 2 caractères.")
    .max(120, "Le nom du projet ne doit pas dépasser 120 caractères."),
  description: z
    .string()
    .overwrite(stripControlChars)
    .trim()
    .max(2000, "La description ne doit pas dépasser 2000 caractères.")
    .default(""),
});
export type ProgramMeta = z.output<typeof ProgramMetaSchema>;

/** Taille maximale du texte d'import de thèmes (octets UTF-8). */
export const THEME_IMPORT_MAX_BYTES = 20 * 1024;
/** Nombre maximal de lignes (thèmes) par import. */
export const THEME_IMPORT_MAX_LINES = 30;
/** Nombre maximal de thèmes par programme (toutes sources confondues). */
export const MAX_THEMES_PER_PROGRAM = 60;

export const ThemeImportTextSchema = z
  .string()
  .refine((s) => Buffer.byteLength(s, "utf8") <= THEME_IMPORT_MAX_BYTES, {
    message: `Le texte importé dépasse ${THEME_IMPORT_MAX_BYTES / 1024} Ko.`,
  });

/** Liste de thèmes à ajouter (proposition d'une analyse de prompt, relue par l'utilisateur). */
export const ThemeListImportSchema = z.object({
  themes: z
    .array(ThemeInputSchema)
    .min(1, "Aucun thème à ajouter.")
    .max(MAX_THEMES_PER_PROGRAM, `${MAX_THEMES_PER_PROGRAM} thèmes au plus.`),
});

export const ThemeIdListSchema = z.array(IdSchema).min(1).max(MAX_THEMES_PER_PROGRAM);

export const SlideIndexSchema = z.number().int().min(0).max(59);

// ---------------------------------------------------------------------------
// Génération du jour J : options de l'action
// ---------------------------------------------------------------------------

/**
 * Choix ponctuel du rédacteur pour UNE génération (repli en un clic) : « Sans
 * IA », ou un fournisseur cloud avec l'origine de sa clé. Ollama n'en fait pas
 * partie (il se choisit dans la Rédaction IA). Même forme que EngineOverride.
 */
export const EngineOverrideSchema = z.discriminatedUnion(
  "engine",
  [
    z.object({ engine: z.literal("free") }).strict(),
    z.object({ engine: CloudProviderSchema, keySource: KeySourceSchema }).strict(),
  ],
  { error: "Rédacteur inconnu." },
);

/** Départ du chrono de préparation : au plus 6 h avant maintenant (cf. MAX_PREP_STATE_AGE_MS). */
export const PREP_STARTED_MAX_AGE_MS = MAX_PREP_STATE_AGE_MS;
/** Avance tolérée de l'horloge du navigateur sur celle du serveur : ramenée à maintenant. */
export const PREP_STARTED_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const GenerationOptionsSchema = z
  .object({
    practice: z.boolean().default(false),
    /** ISO 8601 (avec fuseau) ou null. */
    prepStartedAt: z.iso.datetime({ offset: true, error: "Heure de départ du chrono illisible." }).nullable().default(null),
    override: EngineOverrideSchema.nullable().default(null),
  })
  .strict();
export type GenerationOptionsInput = z.input<typeof GenerationOptionsSchema>;

/**
 * Borne le départ du chrono : dans le futur au-delà de l'avance tolérée, ou plus
 * vieux que 6 h → ignoré (null) ; légèrement en avance → maintenant. Une
 * horloge de navigateur décalée ne doit jamais bloquer la génération du jour J.
 */
export function boundPrepStartedAt(iso: string | null, now: Date): Date | null {
  if (iso === null) return null;
  const at = new Date(iso);
  const t = at.getTime();
  const n = now.getTime();
  if (!Number.isFinite(t) || t < n - PREP_STARTED_MAX_AGE_MS || t > n + PREP_STARTED_CLOCK_SKEW_MS) return null;
  return t > n ? new Date(n) : at;
}
