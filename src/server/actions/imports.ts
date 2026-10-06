"use server";

import type { z } from "zod";
import * as themesRepo from "../repo/themes";
import * as service from "../services/imports";
import { IdSchema, parseInput, ThemeListImportSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction, type ActionContext } from "./run";

/**
 * Imports (apparence depuis un fichier, trame depuis des consignes, sujets et
 * apparence depuis un prompt), tous lus SANS IA. Les actions `analyze*`
 * n'enregistrent RIEN : elles renvoient une proposition que l'interface
 * applique au formulaire, rejouables sans effet (hors quota d'import). Seule
 * `importThemeList` écrit (sujets cochés par l'utilisateur), de façon
 * idempotente.
 */

function deps(ctx: ActionContext): service.ImportsDeps {
  return { log: ctx.log };
}

/** Apparence lue dans un .pptx, .potx ou .thmx d'exemple (PDF et images refusés). Fichier sous `file`. */
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

/** Trame préremplie à partir de consignes (≤ 20 000 caractères), sur la base de la trame actuelle du projet. */
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
 * Sujets ET apparence proposés à partir d'un texte libre décrivant l'oral
 * (≤ 20 000 caractères). N'écrit rien : l'ajout passe par `importThemeList`,
 * l'apparence par l'enregistrement habituel.
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
 * Ajout d'une liste de sujets déjà structurée (proposition d'`analyzeThemePrompt`,
 * relue par l'utilisateur) : 1 à 60 sujets. Même dépôt que l'import texte
 * (`importThemes`), donc même verrou sur le projet, même idempotence par nom
 * (casse et accents ignorés : rejouer ne crée pas de doublon), même plafond de
 * 60 sujets par projet (tout ou rien), positions à la suite.
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
