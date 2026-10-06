import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getEngineForUser } from "@/server/ai";
import { createMockProvider } from "@/server/ai/mock";
import type { AiProvider } from "@/server/ai/types";
import { db } from "@/server/db/client";
import { AiUnavailableError, RateLimitedError } from "@/server/errors";
import {
  AI_LOCAL_GLOBAL_QUOTA,
  AI_LOCAL_GLOBAL_QUOTA_KEY,
  aiLocalQuotaKey,
  API_KEY_VERIFY_GLOBAL_KEY,
  API_KEY_VERIFY_GLOBAL_QUOTA,
} from "@/server/rate-limit";
import * as decks from "@/server/repo/decks";
import * as settings from "@/server/services/ai-settings";
import * as gen from "@/server/services/generation";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

const MASTER = randomBytes(32).toString("base64");
const PROD = { NODE_ENV: "production", SETTINGS_ENCRYPTION_KEY: MASTER } as const;
const KEY = `sk-ant-api03-${"k".repeat(60)}KKKK`;
const PROBLEM = "Comment réduire la consommation de données sur internet ?";

async function count(key: string): Promise<number> {
  return (await db().usageWindow.findUnique({ where: { key } }))?.count ?? 0;
}

async function setup() {
  const a = await createUser("a");
  const programId = await seedProgram(a.id);
  const [themeId] = await seedThemes(programId, [themeInput("Numérique", ["internet", "données"])]);
  return { a, programId, themeId: themeId! };
}

function failingDeck(error: Error): AiProvider {
  const mock = createMockProvider();
  return { name: "ollama:test", engine: "ollama", classify: mock.classify, generateDeck: async () => Promise.reject(error) };
}

describe("S3 — plafond global Ollama", () => {
  it("devrait refuser au-delà du plafond global et restituer la consommation de l'utilisateur", async () => {
    const { a, programId, themeId } = await setup();
    await db().usageWindow.create({
      data: { key: AI_LOCAL_GLOBAL_QUOTA_KEY, windowStart: new Date(), count: AI_LOCAL_GLOBAL_QUOTA.limit },
    });
    const error = await gen.generateFinalDeck(a.id, { programId, themeId, problem: PROBLEM }, { ai: createMockProvider(), log: recordingLogger(), billing: "local" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).scope).toBe("global");
    expect(await count(aiLocalQuotaKey(a.id))).toBe(0);
  });

  it("devrait compter chaque appel Ollama dans le plafond global", async () => {
    const { a, programId, themeId } = await setup();
    await gen.generateFinalDeck(a.id, { programId, themeId, problem: PROBLEM }, { ai: createMockProvider(), log: recordingLogger(), billing: "local" });
    expect(await count(AI_LOCAL_GLOBAL_QUOTA_KEY)).toBe(1);
    expect(await count(aiLocalQuotaKey(a.id))).toBe(1);
  });
});

describe("S4 — plafond global des vérifications de clé", () => {
  it("devrait refuser au-delà du plafond global, sans appel réseau ni consommation utilisateur", async () => {
    const a = await createUser("a");
    await db().usageWindow.create({
      data: { key: API_KEY_VERIFY_GLOBAL_KEY, windowStart: new Date(), count: API_KEY_VERIFY_GLOBAL_QUOTA.limit },
    });
    let called = false;
    const error = await settings
      .activateClaudeWithKey(a.id, { apiKey: KEY }, { env: PROD, log: recordingLogger(), verifyKey: async () => ((called = true), { ok: true }) })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(called).toBe(false);
    expect(await count(`apikey-verify:${a.id}`)).toBe(0);
  });
});

describe("B1 — AI_PROVIDER invalide", () => {
  const BAD = { ...PROD, AI_PROVIDER: "ollama" };

  it("ne devrait pas faire planter la page Configuration IA", async () => {
    const a = await createUser("a");
    const log = recordingLogger();
    const view = await settings.getAiSettingsView(a.id, {
      env: BAD,
      log,
      listOllamaModels: async () => ({ reachable: false, models: [] }),
    });
    expect(view.effectiveSource).toBe("none");
    expect(log.events.some((e) => e.level === "error" && e.event === "ai.misconfigured")).toBe(true);
  });

  it("ne devrait pas empêcher la génération avec le moteur gratuit choisi", async () => {
    const a = await createUser("a");
    await settings.setEngine(a.id, { engine: "free" }, { env: PROD, log: recordingLogger(), listOllamaModels: async () => ({ reachable: false, models: [] }) });
    expect(await getEngineForUser(a.id, { env: BAD, log: recordingLogger() })).toEqual({ engine: "free" });
  });
});

describe("B6 — clé supprimée entre les deux lectures", () => {
  it("devrait appliquer la règle par défaut (gratuit) quand aucune préférence n'est enregistrée", async () => {
    const a = await createUser("a");
    await settings.activateClaudeWithKey(a.id, { apiKey: KEY }, { env: PROD, log: recordingLogger(), verifyKey: async () => ({ ok: true }) });
    // Ligne de la version 1.0 : clé enregistrée sans préférence de moteur.
    await db().userAiSettings.update({ where: { userId: a.id }, data: { engine: null } });
    const r = await getEngineForUser(a.id, { env: PROD, log: recordingLogger(), loadUserApiKey: async () => null });
    expect(r).toEqual({ engine: "free" });
  });
});

describe("B7 — singleFlight par moteur", () => {
  it("ne devrait pas fusionner deux générations simultanées de moteurs différents", async () => {
    const { a, programId, themeId } = await setup();
    const input = { programId, themeId, problem: PROBLEM };
    const [free, ai] = await Promise.all([
      gen.generateFinalDeck(a.id, input, { mode: "free", log: recordingLogger() }),
      gen.generateFinalDeck(a.id, input, { ai: createMockProvider(), log: recordingLogger() }),
    ]);
    expect(free.deckId).not.toBe(ai.deckId);
    expect((await decks.getDeck(a.id, free.deckId)).engine).toBe("free");
    expect((await decks.getDeck(a.id, ai.deckId)).engine).toBe("mock");
  });
});

describe("B8 — remboursement du quota", () => {
  it("devrait restituer l'unité quand Ollama est injoignable (rien n'a été calculé)", async () => {
    const { a, programId, themeId } = await setup();
    const down = new AiUnavailableError("connexion", { refundable: true });
    await expect(
      gen.generateFinalDeck(a.id, { programId, themeId, problem: PROBLEM }, { ai: failingDeck(down), log: recordingLogger(), billing: "local" }),
    ).rejects.toBe(down);
    expect(await count(aiLocalQuotaKey(a.id))).toBe(0);
    expect(await count(AI_LOCAL_GLOBAL_QUOTA_KEY)).toBe(0);
  });

  it("devrait garder l'unité consommée quand le modèle a travaillé (délai dépassé)", async () => {
    const { a, programId, themeId } = await setup();
    const slow = new AiUnavailableError("délai");
    await expect(gen.generateFinalDeck(a.id, { programId, themeId, problem: PROBLEM }, { ai: failingDeck(slow), log: recordingLogger(), billing: "local" })).rejects.toBe(slow);
    expect(await count(aiLocalQuotaKey(a.id))).toBe(1);
  });

  it("devrait restituer aussi pour la clé du serveur (quota utilisateur et global)", async () => {
    const { a, programId, themeId } = await setup();
    const down = new AiUnavailableError("connexion", { refundable: true });
    await expect(gen.generateFinalDeck(a.id, { programId, themeId, problem: PROBLEM }, { ai: failingDeck(down), log: recordingLogger() })).rejects.toBe(down);
    expect(await count(`ai:${a.id}`)).toBe(0);
    expect(await count("ai:global")).toBe(0);
  });

  it("devrait relancer une panne non AppError de la classification au lieu de la maquiller en repli", async () => {
    const { a, programId } = await setup();
    const mock = createMockProvider();
    const bug = new TypeError("bug");
    const ai: AiProvider = { name: "x", generateDeck: mock.generateDeck, classify: async () => Promise.reject(bug) };
    await expect(gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, { ai, log: recordingLogger() })).rejects.toBe(bug);
  });
});
