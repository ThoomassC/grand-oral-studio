import { z } from "zod";
import { brandFromTheme } from "@/domain/import/brand-from-theme";
import { ImportFileError } from "@/domain/import/errors";
import { detectImportFile, type ImportFileKind } from "@/domain/import/file-kind";
import { extractOfficeTheme } from "@/domain/import/office-theme";
import { parseTemplateText, type RecognizedField } from "@/domain/import/template-from-text";
import { parseThemePromptText, type ThemePromptImport } from "@/domain/import/themes-from-text";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeImportQuota } from "../rate-limit";
import { assertProgramOwned, getProgramBrand, getProgramTemplate } from "../repo/programs";

/**
 * Imports d'un projet (apparence depuis un fichier, trame depuis un prompt,
 * sujets et apparence depuis un prompt) — logique métier sans Next ni HTTP.
 * Depuis la 1.1.0, AUCUN import ne passe par une IA : tout est lu de façon
 * déterministe (l'IA n'intervient que le jour J).
 *
 * RIEN n'est enregistré : le résultat est une proposition que l'interface
 * applique au formulaire ; l'enregistrement passe par les actions habituelles.
 *
 * Ordre immuable :
 *   1. autorisation sur le projet (requête filtrée par propriétaire),
 *   2. limite de débit des imports (le seul quota consommé),
 *   3. type du fichier (extension ET signature, taille) avant toute lecture,
 *   4. lecture déterministe, hors de toute transaction.
 */

// ---------------------------------------------------------------------------
// Contrats d'entrée (validés au bord, types dérivés)
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
/** Taille maximale d'un fichier importé (.pptx, .potx, .thmx). */
export const BRAND_FILE_MAX_BYTES = 20 * MB;
export const TEMPLATE_PROMPT_MAX_CHARS = 20_000;

/** Fichier reçu du client (FormData, champ `file`). */
export const BrandFileSchema = z.object({
  file: z
    .instanceof(File, { message: "Choisissez un fichier à importer." })
    .refine((f) => f.size > 0, { message: "Le fichier est vide." })
    .refine((f) => f.size <= BRAND_FILE_MAX_BYTES, { message: `Le fichier dépasse ${BRAND_FILE_MAX_BYTES / MB} Mo.` })
    .refine((f) => f.name.length > 0 && f.name.length <= 255, { message: "Nom de fichier invalide." }),
});

export const TemplatePromptInputSchema = z.object({
  text: z
    .string({ message: "Collez les consignes à analyser." })
    .max(TEMPLATE_PROMPT_MAX_CHARS, { message: `Les consignes ne doivent pas dépasser ${TEMPLATE_PROMPT_MAX_CHARS} caractères.` })
    .refine((s) => s.trim().length > 0, { message: "Collez les consignes à analyser." }),
});
export type TemplatePromptInput = z.output<typeof TemplatePromptInputSchema>;

export const THEME_PROMPT_MAX_CHARS = 20_000;

export const ThemePromptInputSchema = z.object({
  text: z
    .string({ message: "Collez le texte décrivant votre oral." })
    .max(THEME_PROMPT_MAX_CHARS, { message: `Le texte ne doit pas dépasser ${THEME_PROMPT_MAX_CHARS} caractères.` })
    .refine((s) => s.trim().length > 0, { message: "Collez le texte décrivant votre oral." }),
});
export type ThemePromptInput = z.output<typeof ThemePromptInputSchema>;

/** Fichier à analyser : la taille est connue AVANT la lecture des octets. */
export interface ImportFile {
  name: string;
  size: number;
  bytes(): Promise<Uint8Array>;
}

export interface BrandImportResult {
  brand: Brand;
  notes: string[];
}

export interface TemplateImportResult {
  template: PromptTemplate;
  found: string[];
  /** Champs trouvés dans le texte ; les autres valeurs sont celles de la trame actuelle (« par défaut »). */
  recognized: RecognizedField[];
  /** Ce qui a été écarté, coupé ou ignoré à l'analyse (FR, affichable). */
  warnings: string[];
}

export type ThemePromptResult = ThemePromptImport;

// ---------------------------------------------------------------------------
// Dépendances injectables
// ---------------------------------------------------------------------------

export interface ImportsRepo {
  assertProgramOwned(userId: string, programId: string): Promise<void>;
  getProgramTemplate(userId: string, programId: string): Promise<PromptTemplate>;
  getProgramBrand(userId: string, programId: string): Promise<Brand>;
}

export interface ImportsQuotas {
  consumeImport(userId: string): Promise<void>;
}

export interface ImportsDeps {
  log: Logger;
  repo?: ImportsRepo;
  quotas?: ImportsQuotas;
}

const defaultRepo: ImportsRepo = { assertProgramOwned, getProgramTemplate, getProgramBrand };

const defaultQuotas: ImportsQuotas = {
  consumeImport: (userId) => consumeImportQuota(userId),
};

/** Erreur de fichier du domaine → erreur attendue (422), message affichable tel quel. */
function asValidation(error: unknown): never {
  if (error instanceof ImportFileError) throw new ValidationError(error.userMessage, { file: [error.userMessage] });
  throw error;
}

// ---------------------------------------------------------------------------
// (A) Apparence depuis un fichier Office d'exemple
// ---------------------------------------------------------------------------

export async function analyzeBrandFile(
  userId: string,
  programId: string,
  file: ImportFile,
  deps: ImportsDeps,
): Promise<BrandImportResult> {
  const repo = deps.repo ?? defaultRepo;
  const quotas = deps.quotas ?? defaultQuotas;

  await repo.assertProgramOwned(userId, programId);
  await quotas.consumeImport(userId);

  // Défense en profondeur : le bord l'a vérifié, mais on ne lit jamais un fichier trop gros.
  if (file.size > BRAND_FILE_MAX_BYTES) {
    throw new ValidationError(`Le fichier dépasse ${BRAND_FILE_MAX_BYTES / MB} Mo.`, { file: ["Fichier trop volumineux."] });
  }
  const bytes = await file.bytes();
  let kind: ImportFileKind;
  let result: BrandImportResult;
  try {
    ({ kind } = detectImportFile(file.name, bytes));
    result = brandFromTheme(await extractOfficeTheme(bytes, kind));
  } catch (error) {
    // Le nom du fichier n'est jamais journalisé (il peut nommer un client, une personne).
    if (error instanceof ImportFileError) deps.log.info("import.brand_refused", { bytes: bytes.byteLength });
    asValidation(error);
  }
  deps.log.info("import.brand_office", { kind, bytes: bytes.byteLength, notes: result.notes.length });
  return result;
}

// ---------------------------------------------------------------------------
// (B) Trame depuis un prompt
// ---------------------------------------------------------------------------

/** Trame préremplie à partir de consignes, sur la base de la trame actuelle du projet. Le texte n'est jamais journalisé. */
export async function analyzeTemplatePrompt(
  userId: string,
  programId: string,
  input: TemplatePromptInput,
  deps: ImportsDeps,
): Promise<TemplateImportResult> {
  const repo = deps.repo ?? defaultRepo;
  const quotas = deps.quotas ?? defaultQuotas;

  const base = await repo.getProgramTemplate(userId, programId);
  await quotas.consumeImport(userId);

  const { template, found, recognized, warnings } = parseTemplateText(input.text, base);
  deps.log.info("import.template", {
    found: found.length,
    sections: template.sections.length,
    timedSections: template.sections.filter((s) => s.seconds !== undefined).length,
    warnings: warnings.length,
  });
  return { template, found, recognized, warnings };
}

// ---------------------------------------------------------------------------
// (C) Sujets et apparence depuis un prompt
// ---------------------------------------------------------------------------

/**
 * Sujets ET apparence proposés à partir d'un texte libre décrivant l'oral :
 * autorisation (lecture de l'apparence actuelle filtrée par propriétaire),
 * quota d'import, puis lecture déterministe. Rien n'est écrit ; le texte n'est
 * jamais journalisé.
 */
export async function analyzeThemePrompt(
  userId: string,
  programId: string,
  input: ThemePromptInput,
  deps: ImportsDeps,
): Promise<ThemePromptResult> {
  const repo = deps.repo ?? defaultRepo;
  const quotas = deps.quotas ?? defaultQuotas;

  const currentBrand = await repo.getProgramBrand(userId, programId);
  await quotas.consumeImport(userId);

  const result = parseThemePromptText(input.text, currentBrand);
  deps.log.info("import.themes", { themes: result.themes.length, brand: result.brand !== null, notes: result.brandNotes.length });
  return result;
}
