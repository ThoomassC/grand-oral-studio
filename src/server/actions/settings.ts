"use server";

import { revalidatePath } from "next/cache";
import type { SaveApiKeyInput } from "@/domain/api-key";
import { listOllamaModels } from "../ai/ollama";
import { verifyAnthropicKey } from "../ai/verify-key";
import * as service from "../services/ai-settings";
import type { ActionResult } from "./result";
import { runAction, type ActionContext } from "./run";

/**
 * Clé API Anthropic de l'utilisateur connecté (page /configuration-ia). La clé en
 * clair n'est jamais renvoyée : seulement ses 4 derniers caractères.
 */

const SETTINGS_PATH = "/configuration-ia";

const deps = (ctx: ActionContext): service.AiSettingsDeps => ({
  env: process.env,
  log: ctx.log,
  verifyKey: (apiKey) => verifyAnthropicKey(apiKey),
});

/** Valide, vérifie auprès d'Anthropic (sans génération), puis enregistre chiffrée. */
export async function saveAnthropicApiKey(input: SaveApiKeyInput): Promise<ActionResult<{ last4: string }>> {
  return runAction("saveAnthropicApiKey", async (ctx) => {
    const result = await service.saveApiKey(ctx.user.id, input, deps(ctx));
    revalidatePath(SETTINGS_PATH);
    return result;
  });
}

/** Supprime la clé de l'utilisateur (idempotent). */
export async function deleteAnthropicApiKey(): Promise<ActionResult<null>> {
  return runAction("deleteAnthropicApiKey", async (ctx) => {
    await service.deleteApiKey(ctx.user.id, deps(ctx));
    revalidatePath(SETTINGS_PATH);
    return null;
  });
}

/** Revérifie la clé effectivement utilisée (la sienne, sinon celle du serveur). */
export async function testAnthropicApiKey(): Promise<ActionResult<{ source: "user" | "server"; model: string }>> {
  return runAction("testAnthropicApiKey", async (ctx) => {
    const result = await service.testEffectiveKey(ctx.user.id, deps(ctx));
    revalidatePath(SETTINGS_PATH);
    return result;
  });
}

/**
 * Choisit le moteur de rédaction : "claude" (exige une clé), "ollama" (exige un
 * modèle installé sur le serveur Ollama configuré) ou "free".
 */
export async function setAiEngine(input: service.SetEngineInput): Promise<ActionResult<null>> {
  return runAction("setAiEngine", async (ctx) => {
    await service.setEngine(ctx.user.id, input, {
      env: process.env,
      log: ctx.log,
      listOllamaModels: (baseUrl) => listOllamaModels(baseUrl, { timeoutMs: 3_000 }),
    });
    revalidatePath(SETTINGS_PATH);
    return null;
  });
}
