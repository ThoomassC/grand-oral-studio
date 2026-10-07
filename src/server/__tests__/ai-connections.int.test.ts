import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CloudProvider } from "@/domain/ai-providers";
import { getEngineForUser, type ResolvedEngine } from "@/server/ai";
import type { KeyCheck } from "@/server/ai/verify-key";
import { db } from "@/server/db/client";
import { AiKeyRejectedError, AiKeyRequiredError, EngineUnavailableError, RateLimitedError, ValidationError } from "@/server/errors";
import { API_KEY_VERIFY_QUOTA } from "@/server/rate-limit";
import * as settings from "@/server/services/ai-settings";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger } from "./helpers";

setupTestDatabase();

const MASTER = randomBytes(32).toString("base64");
const ENV = { NODE_ENV: "production", SETTINGS_ENCRYPTION_KEY: MASTER } as const;
const MISTRAL_KEY = `${"m".repeat(28)}MMMM`;
const OPENAI_KEY = `sk-proj-${"o".repeat(40)}OOOO`;
const CLAUDE_KEY = `sk-ant-api03-${"c".repeat(60)}CCCC`;

const noOllama = async () => ({ reachable: false, models: [] });
const writerDeps = (env: Record<string, string | undefined> = ENV) => ({ env, log: recordingLogger(), listOllamaModels: noOllama });

function deps(check: KeyCheck = { ok: true }, env: Record<string, string | undefined> = ENV) {
  const verifyKey = vi.fn<(provider: CloudProvider, apiKey: string) => Promise<KeyCheck>>(async () => check);
  return { env, log: recordingLogger(), verifyKey };
}

function cloud(r: ResolvedEngine) {
  if (r.engine === "free" || r.engine === "mock" || r.engine === "ollama") throw new Error("fournisseur cloud attendu");
  return r;
}

/** `fetch` factice : répond 401 et capture URL + en-tête Authorization (aucun appel réseau). */
function capturingFetch() {
  const calls: { url: string; auth: string | null; model: unknown }[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), model: (JSON.parse(String(init?.body)) as { model: unknown }).model });
    return new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 });
  };
  return { impl, calls };
}

describe("connectProvider", () => {
  it("devrait vérifier la clé auprès du bon fournisseur puis l'enregistrer, sans choisir de rédacteur", async () => {
    const a = await createUser("a");
    const d = deps();
    expect(await settings.connectProvider(a.id, { provider: "mistral", apiKey: ` ${MISTRAL_KEY} ` }, d)).toEqual({
      provider: "mistral",
      last4: "MMMM",
      model: "mistral-large-latest",
    });
    expect(d.verifyKey).toHaveBeenCalledWith("mistral", MISTRAL_KEY);
    expect(await db().userAiCredential.count({ where: { userId: a.id, provider: "mistral" } })).toBe(1);
    expect(await db().userAiSettings.count()).toBe(0);
    expect(JSON.stringify(d.log.events)).not.toContain(MISTRAL_KEY);
  });

  it("devrait choisir le rédacteur dans la même écriture avec activate", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "openai", apiKey: OPENAI_KEY, model: "gpt-5", activate: true }, deps());
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({ engine: "openai", keySource: "user" });
    expect((await settings.getWriterView(a.id, { env: ENV })).model).toBe("gpt-5");
  });

  it.each([
    [{ provider: "mistral", apiKey: "sk-ant-api03-mauvais-fournisseur" }, "apiKey"],
    [{ provider: "gemini", apiKey: OPENAI_KEY }, "apiKey"],
    [{ provider: "claude", apiKey: "sk-mauvaise" }, "apiKey"],
    [{ provider: "mistral", apiKey: MISTRAL_KEY, model: "gpt-5" }, "model"],
    [{ provider: "deepseek", apiKey: MISTRAL_KEY }, "provider"],
  ])("devrait refuser une entrée invalide sans appel réseau ni quota (%o)", async (input, field) => {
    const a = await createUser("a");
    const d = deps();
    const error = (await settings.connectProvider(a.id, input, d).catch((e: unknown) => e)) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors?.[field]?.length).toBeGreaterThan(0);
    expect(JSON.stringify(error.fieldErrors)).not.toContain(input.apiKey);
    expect(d.verifyKey).not.toHaveBeenCalled();
    expect(await db().usageWindow.count()).toBe(0);
  });

  it("devrait refuser une clé rejetée par le fournisseur, avec son nom, sans rien enregistrer", async () => {
    const a = await createUser("a");
    const error = (await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY }, deps({ ok: false, reason: "rejected" })).catch(
      (e: unknown) => e,
    )) as ValidationError;
    expect(error.fieldErrors?.apiKey).toEqual(["Cette clé est refusée par Mistral. Vérifiez-la ou créez-en une nouvelle sur console.mistral.ai."]);
    expect(await db().userAiCredential.count()).toBe(0);
  });

  it("devrait partager le quota de vérifications entre fournisseurs", async () => {
    const a = await createUser("a");
    for (let i = 0; i < API_KEY_VERIFY_QUOTA.limit; i += 1) {
      await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY }, deps({ ok: false, reason: "rejected" })).catch(() => undefined);
    }
    const d = deps();
    await expect(settings.connectProvider(a.id, { provider: "openai", apiKey: OPENAI_KEY }, d)).rejects.toBeInstanceOf(RateLimitedError);
    expect(d.verifyKey).not.toHaveBeenCalled();
  });
});

describe("selectWriter", () => {
  it("devrait exiger la clé personnelle pour keySource user, et la clé d'équipe pour keySource server", async () => {
    const a = await createUser("a");
    const noKey = (await settings.selectWriter(a.id, { engine: "mistral", keySource: "user" }, writerDeps()).catch((e: unknown) => e)) as ValidationError;
    expect(noKey.fieldErrors?.engine?.[0]).toMatch(/Connectez d'abord Mistral/);
    const noTeam = (await settings.selectWriter(a.id, { engine: "gemini", keySource: "server" }, writerDeps()).catch((e: unknown) => e)) as ValidationError;
    expect(noTeam.fieldErrors?.keySource?.[0]).toMatch(/clé d'équipe Gemini/);
    expect(await db().userAiSettings.count()).toBe(0);

    await settings.selectWriter(a.id, { engine: "gemini", keySource: "server" }, writerDeps({ ...ENV, GEMINI_API_KEY: "g-team" }));
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({ engine: "gemini", keySource: "server" });
  });

  it("devrait remettre keySource à NULL pour Sans IA et conserver le modèle Ollama", async () => {
    const a = await createUser("a");
    await db().userAiSettings.create({ data: { userId: a.id, engine: "mistral", keySource: "server", ollamaModel: "qwen2.5:14b" } });
    await settings.selectWriter(a.id, { engine: "free" }, writerDeps());
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({ engine: "free", keySource: null, ollamaModel: "qwen2.5:14b" });
  });

  it.each([{ engine: "mistral" }, { engine: "mistral", keySource: "team" }, { engine: "team" }, { engine: "claude", keySource: "server", baseUrl: 1 }])(
    "devrait refuser une entrée invalide (%o)",
    async (input) => {
      const a = await createUser("a");
      const run = settings.selectWriter(a.id, input, writerDeps({ ...ENV, ANTHROPIC_API_KEY: "sk-ant-srv" }));
      if ("baseUrl" in input) await expect(run).resolves.toBeUndefined(); // clé inconnue ignorée (jamais lue)
      else await expect(run).rejects.toBeInstanceOf(ValidationError);
    },
  );
});

describe("testConnection / setConnectionModel / deleteConnection", () => {
  it("devrait revérifier la clé enregistrée et noter la date", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY }, deps());
    await db().userAiCredential.updateMany({ data: { verifiedAt: null } });
    const d = deps();
    const result = await settings.testConnection(a.id, { provider: "mistral" }, d);
    expect(result).toMatchObject({ provider: "mistral", model: "mistral-large-latest" });
    expect(d.verifyKey).toHaveBeenCalledWith("mistral", MISTRAL_KEY);
    expect((await db().userAiCredential.findFirstOrThrow()).verifiedAt?.toISOString()).toBe(result.verifiedAt);
  });

  it("devrait signaler une clé absente ou désormais refusée", async () => {
    const a = await createUser("a");
    await expect(settings.testConnection(a.id, { provider: "openai" }, deps())).rejects.toBeInstanceOf(AiKeyRequiredError);
    await settings.connectProvider(a.id, { provider: "openai", apiKey: OPENAI_KEY }, deps());
    const error = await settings.testConnection(a.id, { provider: "openai" }, deps({ ok: false, reason: "rejected" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiKeyRejectedError);
    expect((error as AiKeyRejectedError).userMessage).toMatch(/OpenAI/);
  });

  it("devrait changer le modèle d'une connexion, refuser un modèle hors liste ou une connexion absente", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY }, deps());
    await settings.setConnectionModel(a.id, { provider: "mistral", model: "mistral-small-latest" }, { log: recordingLogger() });
    expect((await db().userAiCredential.findFirstOrThrow()).model).toBe("mistral-small-latest");
    await expect(settings.setConnectionModel(a.id, { provider: "mistral", model: "gpt-5" }, { log: recordingLogger() })).rejects.toBeInstanceOf(ValidationError);
    await expect(settings.setConnectionModel(a.id, { provider: "gemini", model: "gemini-2.5-pro" }, { log: recordingLogger() })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await settings.setConnectionModel(a.id, { provider: "mistral", model: null }, { log: recordingLogger() });
    expect((await db().userAiCredential.findFirstOrThrow()).model).toBeNull();
  });

  it("devrait supprimer une connexion et ramener la rédaction au choix par défaut", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY, activate: true }, deps());
    await settings.deleteConnection(a.id, { provider: "mistral" }, { log: recordingLogger() });
    expect(await db().userAiCredential.count()).toBe(0);
    expect(await getEngineForUser(a.id, { env: ENV, log: recordingLogger() })).toEqual({ engine: "free" });
  });
});

describe("getEngineForUser — fournisseurs 1.2", () => {
  it("devrait appeler Mistral à son URL fixe avec la clé et le modèle de l'utilisateur, facturé à l'utilisateur", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY, model: "mistral-small-latest", activate: true }, deps());
    const f = capturingFetch();
    const r = cloud(await getEngineForUser(a.id, { env: { ...ENV, MISTRAL_API_KEY: "team" }, fetch: f.impl, log: recordingLogger() }));
    expect(r).toMatchObject({ engine: "mistral", keySource: "user", billing: "user", model: "mistral-small-latest" });
    await expect(r.provider.classify({ system: "s", user: "u" })).rejects.toBeInstanceOf(AiKeyRejectedError);
    expect(f.calls).toEqual([{ url: "https://api.mistral.ai/v1/chat/completions", auth: `Bearer ${MISTRAL_KEY}`, model: "mistral-small-latest" }]);
  });

  it("devrait utiliser la clé d'équipe (modèle par défaut), facturée au serveur", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "openai", apiKey: OPENAI_KEY, model: "gpt-5" }, deps());
    await settings.selectWriter(a.id, { engine: "openai", keySource: "server" }, writerDeps({ ...ENV, OPENAI_API_KEY: "sk-team-key-000000000000000" }));
    const f = capturingFetch();
    const r = cloud(await getEngineForUser(a.id, { env: { ...ENV, OPENAI_API_KEY: "sk-team-key-000000000000000" }, fetch: f.impl, log: recordingLogger() }));
    expect(r).toMatchObject({ engine: "openai", keySource: "server", billing: "server", model: "gpt-5-mini" });
    await r.provider.classify({ system: "s", user: "u" }).catch(() => undefined);
    expect(f.calls[0]).toMatchObject({ url: "https://api.openai.com/v1/chat/completions", auth: "Bearer sk-team-key-000000000000000" });
  });

  it("devrait appliquer une surcharge ponctuelle sans toucher à la sélection, et ne jamais basculer", async () => {
    const a = await createUser("a");
    await settings.activateClaudeWithKey(a.id, { apiKey: CLAUDE_KEY }, { env: ENV, log: recordingLogger(), verifyKey: async () => ({ ok: true }) });
    expect(await getEngineForUser(a.id, { env: ENV, log: recordingLogger(), override: { engine: "free" } })).toEqual({ engine: "free" });
    await expect(getEngineForUser(a.id, { env: ENV, log: recordingLogger(), override: { engine: "mistral", keySource: "user" } })).rejects.toBeInstanceOf(
      AiKeyRequiredError,
    );
    await expect(getEngineForUser(a.id, { env: ENV, log: recordingLogger(), override: { engine: "gemini", keySource: "server" } })).rejects.toBeInstanceOf(
      EngineUnavailableError,
    );
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({ engine: "claude", keySource: "user" });
  });

  it("devrait refuser une clé personnelle supprimée entre la lecture des préférences et le déchiffrement, sans repli sur l'équipe", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY, activate: true }, deps());
    await db().userAiSettings.update({ where: { userId: a.id }, data: { keySource: "user" } });
    await expect(
      getEngineForUser(a.id, { env: { ...ENV, MISTRAL_API_KEY: "team" }, log: recordingLogger(), loadCredential: async () => null }),
    ).rejects.toBeInstanceOf(AiKeyRequiredError);
  });
});

describe("getAiSettingsView / getWriterView", () => {
  it("devrait décrire connexions, clés d'équipe, sélection et rédacteur effectif, sans aucun secret", async () => {
    const a = await createUser("a");
    await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY }, deps());
    await settings.selectWriter(a.id, { engine: "mistral", keySource: "user" }, writerDeps());
    const env = { ...ENV, GEMINI_API_KEY: "g-team", ANTHROPIC_API_KEY: "sk-ant-srv" };
    const view = await settings.getAiSettingsView(a.id, writerDeps(env));
    expect(view).toMatchObject({
      connections: [{ provider: "mistral", last4: "MMMM", model: "mistral-large-latest", defaultModel: true }],
      team: ["claude", "gemini"],
      selection: { engine: "mistral", keySource: "user" },
      effective: { engine: "mistral", keySource: "user", model: "mistral-large-latest", ready: true, problem: null },
      mock: false,
      ollama: { configured: false },
      // Vue 1.1 : un fournisseur 1.2 apparaît comme « claude » (moteur cloud), sans choix 1.1.
      engine: { selected: null, effective: "claude" },
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain(MISTRAL_KEY);
    expect(json).not.toContain("g-team");
    expect(json).not.toMatch(/v1:/);
  });

  it("devrait annoncer un choix inutilisable avec le message de la génération", async () => {
    const a = await createUser("a");
    await db().userAiSettings.create({ data: { userId: a.id, engine: "gemini", keySource: "server" } });
    const writer = await settings.getWriterView(a.id, { env: ENV });
    expect(writer).toMatchObject({ engine: "gemini", keySource: "server", ready: false, label: "Gemini (clé d'équipe)" });
    expect(writer.problem).toMatch(/clé d'équipe Gemini/);
  });

  it.each([
    [{ engine: null, keySource: null }, {}, "Sans IA"],
    [{ engine: null, keySource: null }, { ANTHROPIC_API_KEY: "sk-ant-srv" }, "Claude (clé d'équipe)"],
    [{ engine: "free", keySource: null }, { ANTHROPIC_API_KEY: "sk-ant-srv" }, "Sans IA"],
    [{ engine: "mistral", keySource: "server" }, { MISTRAL_API_KEY: "m" }, "Mistral (clé d'équipe)"],
  ] as const)("libellé du rédacteur (%o, %o) → %s", async (selection, extra, label) => {
    const a = await createUser("a");
    await db().userAiSettings.create({ data: { userId: a.id, ...selection } });
    expect((await settings.getWriterView(a.id, { env: { ...ENV, ...extra } })).label).toBe(label);
  });
});
