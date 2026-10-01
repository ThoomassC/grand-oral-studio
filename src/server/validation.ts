import { z } from "zod";
import { stripControlChars } from "@/domain/schemas";
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

export const ThemeIdListSchema = z.array(IdSchema).min(1).max(MAX_THEMES_PER_PROGRAM);

export const SlideIndexSchema = z.number().int().min(0).max(59);
