"use server";

import { getEngineForUser } from "../ai";
import * as service from "../services/imports";
import { IdSchema, parseInput } from "../validation";
import type { ActionResult } from "./result";
import { runAction, type ActionContext } from "./run";

/**
 * Imports de l'étape 1 (charte depuis un fichier, gabarit depuis des consignes).
 * Ces actions n'enregistrent RIEN : elles renvoient une proposition que
 * l'interface applique au formulaire. Rejouables sans effet (hors quotas).
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
