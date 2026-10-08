"use server";

import { revalidatePath } from "next/cache";
import type { CloudProvider } from "@/domain/ai-providers";
import type { SaveApiKeyInput } from "@/domain/api-key";
import { listOllamaModels } from "../ai/ollama";
import { verifyAnthropicKey, verifyProviderKey } from "../ai/verify-key";
import * as service from "../services/ai-settings";
import type { ActionResult } from "./result";
import { runAction, type ActionContext } from "./run";

/**
 * Configuration IA de l'utilisateur connecté (page /configuration-ia) :
 * connexions par fournisseur (une clé chacun) et choix du rédacteur. Une clé en
 * clair n'est jamais renvoyée : seulement ses 4 derniers caractères.
 */

const SETTINGS_PATH = "/configuration-ia";

const connectionDeps = (ctx: ActionContext): service.ConnectionDeps => ({
  env: process.env,
  log: ctx.log,
  verifyKey: (provider, apiKey) => verifyProviderKey(provider, apiKey),
});

const writerDeps = (ctx: ActionContext) => ({
  env: process.env,
  log: ctx.log,
  listOllamaModels: (baseUrl: string) => listOllamaModels(baseUrl, { timeoutMs: 3_000 }),
});

/** Vérifie la clé auprès du fournisseur (sans génération), puis l'enregistre chiffrée ; `activate` choisit aussi ce rédacteur. */
export async function connectProvider(
  input: service.ConnectProviderInput,
): Promise<ActionResult<{ provider: CloudProvider; last4: string; model: string }>> {
  return runAction("connectProvider", async (ctx) => {
    const result = await service.connectProvider(ctx.user.id, input, connectionDeps(ctx));
    revalidatePath(SETTINGS_PATH);
    return result;
  });
}

/** Choisit le rédacteur : fournisseur cloud + origine de la clé (la sienne ou celle de l'équipe), Ollama ou Sans IA. */
export async function selectWriter(input: service.SelectWriterInput): Promise<ActionResult<null>> {
  return runAction("selectWriter", async (ctx) => {
    await service.selectWriter(ctx.user.id, input, writerDeps(ctx));
    revalidatePath(SETTINGS_PATH);
    return null;
  });
}

/** Revérifie la clé personnelle d'un fournisseur. */
export async function testConnection(
  input: service.ProviderInput,
): Promise<ActionResult<{ provider: CloudProvider; model: string; verifiedAt: string }>> {
  return runAction("testConnection", async (ctx) => {
    const result = await service.testConnection(ctx.user.id, input, connectionDeps(ctx));
    revalidatePath(SETTINGS_PATH);
    return result;
  });
}

/** Supprime la clé d'un fournisseur (idempotent). */
export async function deleteConnection(input: service.ProviderInput): Promise<ActionResult<null>> {
  return runAction("deleteConnection", async (ctx) => {
    await service.deleteConnection(ctx.user.id, input, { log: ctx.log });
    revalidatePath(SETTINGS_PATH);
    return null;
  });
}

/** Change le modèle utilisé avec une clé personnelle (null : modèle par défaut). */
export async function setConnectionModel(input: service.ConnectionModelInput): Promise<ActionResult<null>> {
  return runAction("setConnectionModel", async (ctx) => {
    await service.setConnectionModel(ctx.user.id, input, { log: ctx.log });
    revalidatePath(SETTINGS_PATH);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Actions 1.1, conservées pour l'écran actuel jusqu'au lot UI
// ---------------------------------------------------------------------------

const legacyDeps = (ctx: ActionContext): service.AiSettingsDeps => ({
  env: process.env,
  log: ctx.log,
  verifyKey: (apiKey) => verifyAnthropicKey(apiKey),
});

/**
 * @deprecated « Vérifier et activer » Claude : valide, vérifie auprès d'Anthropic
 * (sans génération), enregistre la clé chiffrée et choisit Claude en une écriture.
 */
export async function activateClaude(input: SaveApiKeyInput): Promise<ActionResult<{ last4: string }>> {
  return runAction("activateClaude", async (ctx) => {
    const result = await service.activateClaudeWithKey(ctx.user.id, input, legacyDeps(ctx));
    revalidatePath(SETTINGS_PATH);
    return result;
  });
}

/** @deprecated Supprime la clé Claude de l'utilisateur (idempotent). */
export async function deleteAnthropicApiKey(): Promise<ActionResult<null>> {
  return runAction("deleteAnthropicApiKey", async (ctx) => {
    await service.deleteApiKey(ctx.user.id, legacyDeps(ctx));
    revalidatePath(SETTINGS_PATH);
    return null;
  });
}

/** @deprecated Revérifie la clé que Claude utiliserait (la sienne, sinon celle du serveur). */
export async function testAnthropicApiKey(): Promise<ActionResult<{ source: "user" | "server"; model: string }>> {
  return runAction("testAnthropicApiKey", async (ctx) => {
    const result = await service.testEffectiveKey(ctx.user.id, legacyDeps(ctx));
    revalidatePath(SETTINGS_PATH);
    return result;
  });
}

/**
 * @deprecated Choisit qui rédige le jour J : "claude" (exige une clé), "ollama"
 * (exige un modèle installé sur le serveur Ollama configuré) ou "free" (Sans IA).
 */
export async function setAiEngine(input: service.SetEngineInput): Promise<ActionResult<null>> {
  return runAction("setAiEngine", async (ctx) => {
    await service.setEngine(ctx.user.id, input, writerDeps(ctx));
    revalidatePath(SETTINGS_PATH);
    return null;
  });
}
