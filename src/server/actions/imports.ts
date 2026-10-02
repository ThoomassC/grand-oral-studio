"use server";

import type { z } from "zod";
import { getEngineForUser } from "../ai";
import * as themesRepo from "../repo/themes";
import * as service from "../services/imports";
import { IdSchema, parseInput, ThemeListImportSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction, type ActionContext } from "./run";

/**
 * Imports (charte depuis un fichier, gabarit depuis des consignes, thèmes et
 * charte depuis un prompt). Les actions `analyze*` n'enregistrent RIEN : elles
 * renvoient une proposition que l'interface applique au formulaire, rejouables
 * sans effet (hors quotas). Seule `importThemeList` écrit (thèmes cochés par
 * l'utilisateur), de façon idempotente.
 */

function deps(ctx: ActionContext): service.ImportsDeps {
  return { log: ctx.log, resolveEngine: () => getEngineForUser(ctx.user.id, { log: ctx.log }) };
}

/** Charte déduite d'un .pptx/.potx/.thmx (gratuit) ou d'un PDF/image (moteur Claude). Fichier sous `file`. */
export async function analyzeBrandFile(
  programId: string,
  formData: FormData,
): Promise<ActionResult<service.BrandImportResult>> {
  return runAction("analyzeBrandFile", async (ctx) => {
    const id = parseInput(IdSchema, programId);
    const raw = formData instanceof FormData ? formData.get("file") : null;
    const { file } = parseInput(service.BrandFileSchema, { file: raw });
    const input: service.ImportFile = {
      name: file.name,
      size: file.size,
      bytes: async () => new Uint8Array(await file.arrayBuffer()),
    };
    return service.analyzeBrandFile(ctx.user.id, id, input, deps(ctx));
  });
}

/** Gabarit prérempli à partir de consignes (≤ 20 000 caractères), sur la base du gabarit actuel du projet. */
export async function analyzeTemplatePrompt(
  programId: string,
  input: { text: string },
): Promise<ActionResult<service.TemplateImportResult>> {
  return runAction("analyzeTemplatePrompt", async (ctx) => {
    const id = parseInput(IdSchema, programId);
    const parsed = parseInput(service.TemplatePromptInputSchema, input);
    return service.analyzeTemplatePrompt(ctx.user.id, id, parsed, deps(ctx));
  });
}

/**
 * Thèmes ET charte proposés à partir d'un texte libre décrivant l'oral
 * (≤ 20 000 caractères). N'écrit rien : l'ajout passe par `importThemeList`,
 * la charte par l'enregistrement habituel.
 */
export async function analyzeThemePrompt(
  programId: string,
  input: { text: string },
): Promise<ActionResult<service.ThemePromptResult>> {
  return runAction("analyzeThemePrompt", async (ctx) => {
    const id = parseInput(IdSchema, programId);
    const parsed = parseInput(service.ThemePromptInputSchema, input);
    return service.analyzeThemePrompt(ctx.user.id, id, parsed, deps(ctx));
  });
}

/**
 * Ajout d'une liste de thèmes déjà structurée (proposition d'`analyzeThemePrompt`,
 * relue par l'utilisateur) : 1 à 60 thèmes. Même dépôt que l'import texte
 * (`importThemes`), donc même verrou sur le projet, même idempotence par nom
 * (casse et accents ignorés : rejouer ne crée pas de doublon), même plafond de
 * 60 thèmes par projet (tout ou rien), positions à la suite.
 */
export async function importThemeList(
  programId: string,
  input: z.input<typeof ThemeListImportSchema>,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  return runAction("importThemeList", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const { themes } = parseInput(ThemeListImportSchema, input);
    const result = await themesRepo.importThemes(user.id, id, themes);
    revalidatePrograms(id);
    return { created: result.created, skipped: result.skipped.length };
  });
}
