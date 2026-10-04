import { z } from "zod";
import { brandFromDraft } from "@/domain/import/brand-from-draft";
import { brandFromTheme } from "@/domain/import/brand-from-theme";
import { ImportFileError } from "@/domain/import/errors";
import { detectImportFile, isOfficeKind, type ImportFileKind } from "@/domain/import/file-kind";
import { extractOfficeTheme } from "@/domain/import/office-theme";
import { buildTemplateDraftPrompt, buildThemePromptDraftPrompt } from "@/domain/import/prompts";
import {
  normalizeTemplateDraft,
  parseTemplateText,
  type RecognizedField,
  type TemplateImport,
} from "@/domain/import/template-from-text";
import { normalizeThemePromptDraft, parseThemePromptText, type ThemePromptImport } from "@/domain/import/themes-from-text";
import { PromptTemplateSchema, type Brand, type PromptTemplate } from "@/domain/schemas";
import type { ResolvedEngine } from "../ai";
import type { BrandDocument } from "../ai/types";
import { AiInvalidOutputError, AiUnavailableError, isAppError, ValidationError, type AppError } from "../errors";
import type { Logger } from "../logger";
import { consumeAiQuotaFor, consumeImportQuota, refundAiQuotaFor, type AiBilling } from "../rate-limit";
import { assertProgramOwned, getProgramBrand, getProgramTemplate } from "../repo/programs";

/**
 * Imports de l'étape 1 d'un projet — logique métier sans Next ni HTTP.
 * RIEN n'est enregistré : le résultat est une proposition que l'interface
 * applique au formulaire ; l'enregistrement passe par les actions habituelles.
 *
 * Ordre immuable :
 *   1. autorisation sur le projet (requête filtrée par propriétaire),
 *   2. limite de débit des imports,
 *   3. type du fichier (extension ET signature, taille par type) avant tout coût IA,
 *   4. lecture déterministe (Office) ou appel IA facturé (quota IA, restitué si
 *      rien n'a été calculé), hors de toute transaction.
 */

// ---------------------------------------------------------------------------
// Contrats d'entrée (validés au bord, types dérivés)
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
/** Taille maximale d'un fichier importé (le plus grand des plafonds par type). */
export const BRAND_FILE_MAX_BYTES = 20 * MB;
export const TEMPLATE_PROMPT_MAX_CHARS = 20_000;

export const VISION_ENGINE_REQUIRED_MESSAGE =
  "La lecture d'un PDF ou d'une image demande le moteur Claude (Configuration IA). Avec un .pptx, .potx ou .thmx, l'import est gratuit.";

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
  source: "office" | "ai";
}

export interface TemplateImportResult {
  template: PromptTemplate;
  found: string[];
  /** Champs trouvés dans le texte ; les autres valeurs sont celles du gabarit actuel (« par défaut »). */
  recognized: RecognizedField[];
  /** Ce qui a été écarté, coupé ou ignoré à l'analyse (FR, affichable). */
  warnings: string[];
  source: "ai" | "free";
  fallbackReason: string | null;
}

export interface ThemePromptResult extends ThemePromptImport {
  source: "ai" | "free";
  fallbackReason: string | null;
}

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
  consumeAi(billing: AiBilling, userId: string): Promise<void>;
  refundAi(billing: AiBilling, userId: string): Promise<void>;
}

export interface ImportsDeps {
  log: Logger;
  /** Résolu paresseusement : la lecture d'un fichier Office n'en a jamais besoin. */
  resolveEngine: () => Promise<ResolvedEngine>;
  repo?: ImportsRepo;
  quotas?: ImportsQuotas;
}

const defaultRepo: ImportsRepo = { assertProgramOwned, getProgramTemplate, getProgramBrand };

const defaultQuotas: ImportsQuotas = {
  consumeImport: (userId) => consumeImportQuota(userId),
  consumeAi: (billing, userId) => consumeAiQuotaFor(billing, userId, 1),
  refundAi: (billing, userId) => refundAiQuotaFor(billing, userId, 1),
};

/** Erreur de fichier du domaine → erreur attendue (422), message affichable tel quel. */
function asValidation(error: unknown): never {
  if (error instanceof ImportFileError) throw new ValidationError(error.userMessage, { file: [error.userMessage] });
  throw error;
}

/** Appel IA facturé : quota consommé avant, restitué si l'échec prouve que rien n'a été calculé. */
async function billed<T>(
  userId: string,
  billing: AiBilling,
  quotas: ImportsQuotas,
  log: Logger,
  call: () => Promise<T>,
): Promise<T> {
  await quotas.consumeAi(billing, userId);
  try {
    return await call();
  } catch (error) {
    if (error instanceof AiUnavailableError && error.refundable) {
      await quotas.refundAi(billing, userId);
      log.info("ai.quota_refunded", { detail: error.detail });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// (A) Charte depuis un fichier
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
  try {
    ({ kind } = detectImportFile(file.name, bytes));
  } catch (error) {
    asValidation(error);
  }

  if (isOfficeKind(kind)) {
    let result: { brand: Brand; notes: string[] };
    try {
      result = brandFromTheme(await extractOfficeTheme(bytes, kind));
    } catch (error) {
      asValidation(error);
    }
    deps.log.info("import.brand_office", { kind, bytes: bytes.byteLength, notes: result.notes.length });
    return { ...result, source: "office" };
  }

  // PDF ou image : vision, seulement avec le moteur Claude (ou son substitut de dev, le mock).
  const engine = await deps.resolveEngine();
  if ((engine.engine !== "claude" && engine.engine !== "mock") || !engine.provider.deduceBrand) {
    throw new ValidationError(VISION_ENGINE_REQUIRED_MESSAGE, { file: [VISION_ENGINE_REQUIRED_MESSAGE] });
  }
  const deduce = engine.provider.deduceBrand.bind(engine.provider);
  const document: BrandDocument = { kind, base64: Buffer.from(bytes).toString("base64") };
  const raw = await billed(userId, engine.billing, quotas, deps.log, () => deduce(document));
  const result = brandFromDraft(raw);
  deps.log.info("import.brand_ai", { kind, bytes: bytes.byteLength, engine: engine.engine, notes: result.notes.length });
  return { brand: result.brand, notes: ["Charte déduite par l'IA : vérifiez les couleurs et les polices.", ...result.notes], source: "ai" };
}

// ---------------------------------------------------------------------------
// (B) Gabarit depuis un prompt
// ---------------------------------------------------------------------------

function fallbackReasonOf(error: AppError): string {
  if (error instanceof AiInvalidOutputError) return "L'IA a renvoyé une réponse inexploitable.";
  return error.userMessage || "Le service IA n'a pas répondu.";
}

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

  const free = (fallbackReason: string | null): TemplateImportResult => {
    const { template, found, recognized, warnings } = parseTemplateText(input.text, base);
    return { template, found, recognized, warnings, source: "free", fallbackReason };
  };

  let engine: ResolvedEngine;
  try {
    engine = await deps.resolveEngine();
  } catch (error) {
    // Moteur choisi mais indisponible : l'analyse sans IA répond quand même, avec l'explication.
    if (!isAppError(error)) throw error;
    deps.log.warn("import.template_engine_unavailable", { code: error.code });
    return free(error.userMessage);
  }
  if (engine.engine === "free") return free(null);

  const draft = engine.provider.draftTemplate?.bind(engine.provider);
  if (!draft) return free("Ce moteur ne sait pas analyser des consignes.");
  try {
    const prompt = buildTemplateDraftPrompt(input.text, base);
    const raw = await billed(userId, engine.billing, quotas, deps.log, () =>
      draft(prompt, { text: input.text, base }),
    );
    // Le texte source sert à écarter ce que l'IA aurait inventé (durée, format absents du texte).
    const normalized: TemplateImport = normalizeTemplateDraft(raw, base, input.text);
    // La durée lue dans le texte est reprise même si l'IA n'en propose pas : elle ne compte pas comme apport de l'IA.
    const fromAi = normalized.recognized.filter((f) => f !== "durationMinutes" || raw.durationMinutes !== undefined);
    if (fromAi.length === 0) throw new AiInvalidOutputError("draftTemplate: aucun élément repris");
    const checked = PromptTemplateSchema.safeParse(normalized.template);
    if (!checked.success) throw new AiInvalidOutputError("draftTemplate: gabarit hors contrat après normalisation");
    const template = checked.data;
    deps.log.info("import.template_ai", {
      engine: engine.engine,
      found: normalized.found.length,
      sections: template.sections.length,
      warnings: normalized.warnings.length,
    });
    return {
      template,
      found: normalized.found,
      recognized: normalized.recognized,
      warnings: normalized.warnings,
      source: "ai",
      fallbackReason: null,
    };
  } catch (error) {
    // Un bug de code ou une panne de base n'est pas une défaillance de l'IA : pas de maquillage en repli.
    if (!isAppError(error)) throw error;
    deps.log.warn("import.template_fallback_free", { code: error.code });
    return free(fallbackReasonOf(error));
  }
}

// ---------------------------------------------------------------------------
// (C) Thèmes et charte depuis un prompt
// ---------------------------------------------------------------------------

/**
 * Thèmes ET charte proposés à partir d'un texte libre décrivant l'oral. Même
 * ordre et mêmes replis que `analyzeTemplatePrompt` : autorisation (lecture de
 * la charte actuelle filtrée par propriétaire), quota d'import, puis IA facturée
 * ou analyse gratuite. Rien n'est écrit ; le texte n'est jamais journalisé.
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

  const free = (fallbackReason: string | null): ThemePromptResult => {
    const result = parseThemePromptText(input.text, currentBrand);
    deps.log.info("import.themes_free", { themes: result.themes.length, brand: result.brand !== null, fallback: fallbackReason !== null });
    return { ...result, source: "free", fallbackReason };
  };

  let engine: ResolvedEngine;
  try {
    engine = await deps.resolveEngine();
  } catch (error) {
    if (!isAppError(error)) throw error;
    deps.log.warn("import.themes_engine_unavailable", { code: error.code });
    return free(error.userMessage);
  }
  if (engine.engine === "free") return free(null);

  const draft = engine.provider.draftThemes?.bind(engine.provider);
  if (!draft) return free("Ce moteur ne sait pas analyser ce texte.");
  try {
    const prompt = buildThemePromptDraftPrompt(input.text);
    const raw = await billed(userId, engine.billing, quotas, deps.log, () => draft(prompt, { text: input.text, brand: currentBrand }));
    const normalized = normalizeThemePromptDraft(raw, currentBrand);
    if (normalized.themes.length === 0 && normalized.brand === null) {
      throw new AiInvalidOutputError("draftThemes: aucun élément repris");
    }
    deps.log.info("import.themes_ai", {
      engine: engine.engine,
      themes: normalized.themes.length,
      brand: normalized.brand !== null,
      notes: normalized.brandNotes.length,
    });
    return { ...normalized, source: "ai", fallbackReason: null };
  } catch (error) {
    // Un bug de code ou une panne de base n'est pas une défaillance de l'IA : pas de maquillage en repli.
    if (!isAppError(error)) throw error;
    deps.log.warn("import.themes_fallback_free", { code: error.code });
    return free(fallbackReasonOf(error));
  }
}
