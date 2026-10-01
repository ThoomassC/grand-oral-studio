import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getEngineForUser, type ResolvedEngine } from "@/server/ai";
import type { KeyCheck } from "@/server/ai/verify-key";
import { EncryptionKeyMissingError } from "@/server/crypto/secret-box";
import { db } from "@/server/db/client";
import {
  AiKeyRejectedError,
  AiKeyRequiredError,
  AiKeyUnreadableError,
  AiUnavailableError,
  RateLimitedError,
  ValidationError,
} from "@/server/errors";
import { AI_GLOBAL_QUOTA, AI_GLOBAL_QUOTA_KEY, aiOwnKeyQuotaKey, aiQuotaKey, API_KEY_VERIFY_QUOTA } from "@/server/rate-limit";
import { loadUserApiKey } from "@/server/repo/ai-settings";
import * as settings from "@/server/services/ai-settings";
import * as gen from "@/server/services/generation";
import { createMockProvider } from "@/server/ai/mock";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

const MASTER_1 = randomBytes(32).toString("base64");
const MASTER_2 = randomBytes(32).toString("base64");
const ENV = { NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: MASTER_1 } as const;
const KEY_A = `sk-ant-api03-${"a".repeat(60)}AAAA`;
const KEY_B = `sk-ant-api03-${"b".repeat(60)}BBBB`;

/** Ollama non configuré : la sonde ne doit pas être appelée. */
const noOllama = async () => {
  throw new Error("sonde Ollama inattendue");
};
const view = (userId: string, env: Record<string, string | undefined>) =>
  settings.getAiSettingsView(userId, { env, listOllamaModels: noOllama });

function aiOf(r: ResolvedEngine) {
  if (r.engine === "free") throw new Error("moteur IA attendu");
  return r;
}

function deps(check: KeyCheck = { ok: true }, env: Record<string, string | undefined> = ENV) {
  const verifyKey = vi.fn<(apiKey: string) => Promise<KeyCheck>>(async () => check);
  return { env, log: recordingLogger(), verifyKey };
}

async function count(key: string): Promise<number> {
  return (await db().usageWindow.findUnique({ where: { key } }))?.count ?? 0;
}

describe("saveApiKey", () => {
  it("devrait vérifier la clé puis l'enregistrer chiffrée, sans jamais stocker le clair", async () => {
    const a = await createUser("a");
    const d = deps();
    expect(await settings.saveApiKey(a.id, { apiKey: `  ${KEY_A}  ` }, d)).toEqual({ last4: "AAAA" });
    expect(d.verifyKey).toHaveBeenCalledWith(KEY_A);

    const row = await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } });
    expect(row.anthropicKeyCiphertext).toMatch(/^v1:/);
    expect(row.anthropicKeyCiphertext).not.toContain("aaaa");
    expect(row.anthropicKeyLast4).toBe("AAAA");
    expect(row.keyVersion).toBe(1);
    expect(await loadUserApiKey(a.id, { env: ENV, log: recordingLogger() })).toBe(KEY_A);
  });

  it("ne devrait jamais journaliser la clé", async () => {
    const a = await createUser("a");
    const d = deps();
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, d);
    expect(JSON.stringify(d.log.events)).not.toContain(KEY_A.slice(0, 30));
  });

  it("devrait remplacer la clé quand on la réenregistre (une seule ligne, rejouable)", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    await settings.saveApiKey(a.id, { apiKey: KEY_B }, deps());
    expect(await db().userAiSettings.count({ where: { userId: a.id } })).toBe(1);
    expect(await loadUserApiKey(a.id, { env: ENV, log: recordingLogger() })).toBe(KEY_B);
  });

  it("devrait refuser une clé rejetée par Anthropic avec une erreur sur le champ apiKey, sans rien enregistrer", async () => {
    const a = await createUser("a");
    const error = await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps({ ok: false, reason: "rejected" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.apiKey).toEqual([
      "Cette clé est refusée par Anthropic. Vérifiez-la ou créez-en une nouvelle sur console.anthropic.com.",
    ]);
    expect(await db().userAiSettings.count()).toBe(0);
  });

  it("devrait signaler une API injoignable sans rien enregistrer", async () => {
    const a = await createUser("a");
    const error = await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps({ ok: false, reason: "unavailable" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).userMessage).toBe("Impossible de vérifier la clé pour le moment. Réessayez.");
    expect(await db().userAiSettings.count()).toBe(0);
  });

  it("devrait refuser un format invalide sans appel réseau ni consommation de quota", async () => {
    const a = await createUser("a");
    const d = deps();
    const error = await settings.saveApiKey(a.id, { apiKey: "sk-mauvaise" }, d).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.apiKey?.length).toBeGreaterThan(0);
    expect(d.verifyKey).not.toHaveBeenCalled();
    expect(await count(`apikey-verify:${a.id}`)).toBe(0);
  });

  it("devrait refuser l'enregistrement sans clé maître, avant tout appel réseau", async () => {
    const a = await createUser("a");
    const d = deps({ ok: true }, { NODE_ENV: "development" });
    await expect(settings.saveApiKey(a.id, { apiKey: KEY_A }, d)).rejects.toBeInstanceOf(EncryptionKeyMissingError);
    expect(d.verifyKey).not.toHaveBeenCalled();
  });

  it("devrait limiter le nombre de vérifications par utilisateur (pas d'oracle à clés)", async () => {
    const a = await createUser("a");
    for (let i = 0; i < API_KEY_VERIFY_QUOTA.limit; i += 1) {
      await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps({ ok: false, reason: "rejected" })).catch(() => undefined);
    }
    const d = deps();
    const error = await settings.saveApiKey(a.id, { apiKey: KEY_A }, d).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).userMessage).toMatch(/vérifications de clé/);
    expect(d.verifyKey).not.toHaveBeenCalled();
  });
});

describe("isolement entre utilisateurs", () => {
  it("devrait donner à chacun sa propre clé et ne jamais exposer celle d'un autre", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    await settings.saveApiKey(b.id, { apiKey: KEY_B }, deps());
    const log = recordingLogger();
    expect(await loadUserApiKey(a.id, { env: ENV, log })).toBe(KEY_A);
    expect(await loadUserApiKey(b.id, { env: ENV, log })).toBe(KEY_B);
    expect((await view(b.id, ENV)).userKey.last4).toBe("BBBB");
  });

  it("ne devrait pas déchiffrer un chiffré recopié sur la ligne d'un autre utilisateur (AAD)", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    const rowA = await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } });
    await db().userAiSettings.create({
      data: { userId: b.id, anthropicKeyCiphertext: rowA.anthropicKeyCiphertext, anthropicKeyLast4: "AAAA", keyVersion: 1 },
    });
    await expect(loadUserApiKey(b.id, { env: ENV, log: recordingLogger() })).rejects.toBeInstanceOf(AiKeyUnreadableError);
  });

  it("devrait supprimer uniquement la clé de l'appelant", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    await settings.saveApiKey(b.id, { apiKey: KEY_B }, deps());
    await settings.deleteApiKey(a.id, { log: recordingLogger() });
    expect(await loadUserApiKey(a.id, { env: ENV, log: recordingLogger() })).toBeNull();
    expect(await loadUserApiKey(b.id, { env: ENV, log: recordingLogger() })).toBe(KEY_B);
  });
});

describe("deleteApiKey", () => {
  it("devrait être idempotent et ramener la source effective au repli", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    await settings.deleteApiKey(a.id, { log: recordingLogger() });
    await settings.deleteApiKey(a.id, { log: recordingLogger() });
    const v = await view(a.id, { ...ENV, ANTHROPIC_API_KEY: "sk-ant-server-key" });
    expect(v.userKey).toEqual({ configured: false, last4: null, updatedAt: null });
    expect(v.effectiveSource).toBe("server");
  });

  it("devrait disparaître avec l'utilisateur (cascade)", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    await db().user.delete({ where: { id: a.id } });
    expect(await db().userAiSettings.count()).toBe(0);
  });
});

describe("getAiSettingsView", () => {
  it("ne devrait contenir ni la clé ni son chiffré", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    const row = await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } });
    const v = await view(a.id, ENV);
    const json = JSON.stringify(v);
    expect(json).not.toContain(KEY_A.slice(0, 20));
    expect(json).not.toContain(row.anthropicKeyCiphertext!);
    expect(v).toMatchObject({
      userKey: { configured: true, last4: "AAAA", updatedAt: row.updatedAt.toISOString() },
      effectiveSource: "user",
      model: "claude-opus-5-5",
    });
  });

  it.each([
    [{ NODE_ENV: "production" }, "none", "claude-opus-5-5"],
    [{ NODE_ENV: "development" }, "none", "claude-opus-5-5"],
    [{ NODE_ENV: "development", AI_PROVIDER: "mock" }, "mock", "mock"],
    [{ NODE_ENV: "production", ANTHROPIC_API_KEY: "sk-ant-srv", AI_MODEL: "claude-x" }, "server", "claude-x"],
  ] as const)("devrait indiquer la source effective sans clé utilisateur (%o)", async (env, source, model) => {
    const a = await createUser("a");
    const v = await view(a.id, env);
    expect(v.effectiveSource).toBe(source);
    expect(v.model).toBe(model);
  });
});

describe("rotation de la clé maître", () => {
  it("devrait lire une clé chiffrée avec l'ancienne clé maître puis la rechiffrer avec la nouvelle", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    const rotated = {
      NODE_ENV: "test",
      SETTINGS_ENCRYPTION_KEY: MASTER_2,
      SETTINGS_ENCRYPTION_KEY_VERSION: "2",
      SETTINGS_ENCRYPTION_KEY_PREVIOUS: MASTER_1,
    };
    expect(await loadUserApiKey(a.id, { env: rotated, log: recordingLogger() })).toBe(KEY_A);
    expect((await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).keyVersion).toBe(2);
    // L'ancienne clé maître n'est plus nécessaire.
    const onlyNew = { NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: MASTER_2, SETTINGS_ENCRYPTION_KEY_VERSION: "2" };
    expect(await loadUserApiKey(a.id, { env: onlyNew, log: recordingLogger() })).toBe(KEY_A);
  });

  it("devrait signaler une clé illisible (sans repli silencieux) si la clé maître a changé sans rotation", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    const env = { NODE_ENV: "production", SETTINGS_ENCRYPTION_KEY: MASTER_2, ANTHROPIC_API_KEY: "sk-ant-srv" };
    await expect(getEngineForUser(a.id, { env, log: recordingLogger() })).rejects.toBeInstanceOf(AiKeyUnreadableError);
  });
});

describe("contraintes de la base", () => {
  it("devrait refuser une clé en clair ou des 4 derniers caractères mal formés", async () => {
    const a = await createUser("a");
    await expect(
      db().userAiSettings.create({ data: { userId: a.id, anthropicKeyCiphertext: KEY_A, anthropicKeyLast4: "AAAA", keyVersion: 1 } }),
    ).rejects.toThrow();
    await expect(
      db().userAiSettings.create({ data: { userId: a.id, anthropicKeyCiphertext: "v1:a:b:c", anthropicKeyLast4: "AA", keyVersion: 1 } }),
    ).rejects.toThrow();
    await expect(
      db().userAiSettings.create({ data: { userId: a.id, anthropicKeyCiphertext: "v1:a:b:c", anthropicKeyLast4: "AAAA", keyVersion: 0 } }),
    ).rejects.toThrow();
  });
});

/** `fetch` factice qui répond 401 et capture la clé envoyée (aucun appel réseau). */
function capturingFetch() {
  const keys: (string | null)[] = [];
  const impl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    keys.push(new Headers(init?.headers).get("x-api-key"));
    return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };
  return { impl, keys };
}

describe("getEngineForUser (Claude)", () => {
  const PROMPT = { system: "s", user: "u" };

  it("devrait appeler Anthropic avec la clé de l'utilisateur, et non celle du serveur", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    const env = { ...ENV, ANTHROPIC_API_KEY: "sk-ant-server-key" };

    const fa = capturingFetch();
    const ra = aiOf(await getEngineForUser(a.id, { env, fetch: fa.impl, log: recordingLogger() }));
    expect(ra).toMatchObject({ engine: "claude", billing: "user" });
    await expect(ra.provider.classify(PROMPT)).rejects.toBeInstanceOf(AiKeyRejectedError);
    expect(new Set(fa.keys)).toEqual(new Set([KEY_A]));

    const fb = capturingFetch();
    const rb = aiOf(await getEngineForUser(b.id, { env, fetch: fb.impl, log: recordingLogger() }));
    expect(rb).toMatchObject({ engine: "claude", billing: "server" });
    await expect(rb.provider.classify(PROMPT)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(new Set(fb.keys)).toEqual(new Set(["sk-ant-server-key"]));
  });

  it("devrait retenir le moteur gratuit sans aucune clé, même en production (plus d'erreur bloquante)", async () => {
    const a = await createUser("a");
    expect(await getEngineForUser(a.id, { env: { NODE_ENV: "production" }, log: recordingLogger() })).toEqual({ engine: "free" });
  });

  it("devrait utiliser le mock seulement avec AI_PROVIDER=mock", async () => {
    const a = await createUser("a");
    const r = await getEngineForUser(a.id, { env: { NODE_ENV: "development", AI_PROVIDER: "mock" }, log: recordingLogger() });
    expect(r.engine).toBe("mock");
  });
});

describe("quotas selon la clé utilisée", () => {
  async function setup() {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Numérique", ["internet"])]);
    return { a, themeId: themeId! };
  }

  it("ne devrait pas entamer le plafond global ni le quota serveur avec la clé de l'utilisateur", async () => {
    const { a, themeId } = await setup();
    await gen.generateSkeleton(a.id, themeId, { ai: createMockProvider(), log: recordingLogger(), billing: "user" });
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(1);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
    expect(await count(AI_GLOBAL_QUOTA_KEY)).toBe(0);
  });

  it("devrait générer avec sa clé même quand le plafond global est atteint", async () => {
    const { a, themeId } = await setup();
    await db().usageWindow.create({ data: { key: AI_GLOBAL_QUOTA_KEY, windowStart: new Date(), count: AI_GLOBAL_QUOTA.limit } });
    await expect(
      gen.generateSkeleton(a.id, themeId, { ai: createMockProvider(), log: recordingLogger(), billing: "server" }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      gen.generateSkeleton(a.id, themeId, { ai: createMockProvider(), log: recordingLogger(), billing: "user" }),
    ).resolves.toMatchObject({ warnings: [] });
  });

  it("devrait conserver un quota par utilisateur sur sa propre clé (protection contre les boucles)", async () => {
    const { a, themeId } = await setup();
    await db().usageWindow.create({ data: { key: aiOwnKeyQuotaKey(a.id), windowStart: new Date(), count: 200 } });
    await expect(
      gen.generateSkeleton(a.id, themeId, { ai: createMockProvider(), log: recordingLogger(), billing: "user" }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("devrait appliquer quota utilisateur et plafond global sur la clé du serveur (défaut)", async () => {
    const { a, themeId } = await setup();
    await gen.generateSkeleton(a.id, themeId, { ai: createMockProvider(), log: recordingLogger() });
    expect(await count(aiQuotaKey(a.id))).toBe(1);
    expect(await count(AI_GLOBAL_QUOTA_KEY)).toBe(1);
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(0);
  });
});

describe("testEffectiveKey", () => {
  it("devrait revérifier la clé de l'utilisateur", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    const d = deps();
    expect(await settings.testEffectiveKey(a.id, d)).toEqual({ source: "user", model: "claude-opus-5-5" });
    expect(d.verifyKey).toHaveBeenCalledWith(KEY_A);
  });

  it("devrait signaler une clé utilisateur désormais refusée", async () => {
    const a = await createUser("a");
    await settings.saveApiKey(a.id, { apiKey: KEY_A }, deps());
    await expect(settings.testEffectiveKey(a.id, deps({ ok: false, reason: "rejected" }))).rejects.toBeInstanceOf(
      AiKeyRejectedError,
    );
  });

  it("devrait vérifier la clé serveur quand l'utilisateur n'en a pas", async () => {
    const a = await createUser("a");
    const d = deps({ ok: true }, { ...ENV, ANTHROPIC_API_KEY: "sk-ant-server-key" });
    expect(await settings.testEffectiveKey(a.id, d)).toEqual({ source: "server", model: "claude-opus-5-5" });
    expect(d.verifyKey).toHaveBeenCalledWith("sk-ant-server-key");
  });

  it("devrait refuser de tester le mode simulé, et demander une clé en production", async () => {
    const a = await createUser("a");
    await expect(settings.testEffectiveKey(a.id, deps({ ok: true }, { NODE_ENV: "development", AI_PROVIDER: "mock" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(settings.testEffectiveKey(a.id, deps({ ok: true }, { NODE_ENV: "production" }))).rejects.toBeInstanceOf(
      AiKeyRequiredError,
    );
  });
});
