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
import { recordingLogger, seedLegacyCredential } from "./helpers";

setupTestDatabase();

const MASTER = randomBytes(32).toString("base64");
const ENV = { NODE_ENV: "production", SETTINGS_ENCRYPTION_KEY: MASTER } as const;
const MISTRAL_KEY = `${"m".repeat(28)}MMMM`;
const GEMINI_KEY = `AIza${"g".repeat(32)}GGGG`;
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
    await settings.connectProvider(a.id, { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-2.5-pro", activate: true }, deps());
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({ engine: "gemini", keySource: "user" });
    expect((await settings.getWriterView(a.id, { env: ENV })).model).toBe("gemini-2.5-pro");
  });

  it.each([
    [{ provider: "mistral", apiKey: "sk-ant-api03-mauvais-fournisseur" }, "apiKey"],
    [{ provider: "gemini", apiKey: OPENAI_KEY }, "apiKey"],
    [{ provider: "claude", apiKey: "sk-mauvaise" }, "provider"],
    [{ provider: "claude", apiKey: CLAUDE_KEY }, "provider"],
    [{ provider: "openai", apiKey: OPENAI_KEY }, "provider"],
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
    await expect(settings.connectProvider(a.id, { provider: "gemini", apiKey: GEMINI_KEY }, d)).rejects.toBeInstanceOf(RateLimitedError);
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

  it.each([{ engine: "mistral" }, { engine: "mistral", keySource: "team" }, { engine: "team" }, { engine: "mistral", keySource: "server", baseUrl: 1 }])(
    "devrait refuser une entrée invalide (%o)",
    async (input) => {
      const a = await createUser("a");
      const run = settings.selectWriter(a.id, input, writerDeps({ ...ENV, MISTRAL_API_KEY: "m-team" }));
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
    await expect(settings.testConnection(a.id, { provider: "gemini" }, deps())).rejects.toBeInstanceOf(AiKeyRequiredError);
    await settings.connectProvider(a.id, { provider: "gemini", apiKey: GEMINI_KEY }, deps());
    const error = await settings.testConnection(a.id, { provider: "gemini" }, deps({ ok: false, reason: "rejected" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiKeyRejectedError);
    expect((error as AiKeyRejectedError).userMessage).toMatch(/Gemini/);
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
    const env = { ...ENV, GEMINI_API_KEY: "g-team-key" };
    await settings.connectProvider(a.id, { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-2.5-pro" }, deps());
    await settings.selectWriter(a.id, { engine: "gemini", keySource: "server" }, writerDeps(env));
    const f = capturingFetch();
    const r = cloud(await getEngineForUser(a.id, { env, fetch: f.impl, log: recordingLogger() }));
    expect(r).toMatchObject({ engine: "gemini", keySource: "server", billing: "server", model: "gemini-2.5-flash" });
    await r.provider.classify({ system: "s", user: "u" }).catch(() => undefined);
    expect(f.calls[0]).toMatchObject({
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      auth: "Bearer g-team-key",
    });
  });

  it("devrait appliquer une surcharge ponctuelle sans toucher à la sélection, et ne jamais basculer", async () => {
    const a = await createUser("a");
    await seedLegacyCredential(a.id, "claude", CLAUDE_KEY, ENV);
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
      // Clés d'équipe des seuls fournisseurs proposés : ANTHROPIC_API_KEY n'ajoute plus de carte.
      team: ["gemini"],
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
    // 1.2 : sans préférence, plus jamais Claude ; la clé d'équipe Mistral, sinon Gemini.
    [{ engine: null, keySource: null }, { ANTHROPIC_API_KEY: "sk-ant-srv", OPENAI_API_KEY: "o" }, "Sans IA"],
    [{ engine: null, keySource: null }, { ANTHROPIC_API_KEY: "sk-ant-srv", GEMINI_API_KEY: "g", MISTRAL_API_KEY: "m" }, "Mistral (clé d'équipe)"],
    [{ engine: null, keySource: null }, { GEMINI_API_KEY: "g" }, "Gemini (clé d'équipe)"],
    // Sélection explicite héritée : honorée.
    [{ engine: "claude", keySource: "server" }, { ANTHROPIC_API_KEY: "sk-ant-srv", MISTRAL_API_KEY: "m" }, "Claude (clé d'équipe)"],
    [{ engine: "free", keySource: null }, { ANTHROPIC_API_KEY: "sk-ant-srv" }, "Sans IA"],
    [{ engine: "mistral", keySource: "server" }, { MISTRAL_API_KEY: "m" }, "Mistral (clé d'équipe)"],
  ] as const)("libellé du rédacteur (%o, %o) → %s", async (selection, extra, label) => {
    const a = await createUser("a");
    await db().userAiSettings.create({ data: { userId: a.id, ...selection } });
    expect((await settings.getWriterView(a.id, { env: { ...ENV, ...extra } })).label).toBe(label);
  });
});

describe("Claude et OpenAI ne sont plus proposés (1.2)", () => {
  it.each(["claude", "openai"] as const)("devrait refuser une nouvelle connexion %s, sans appel réseau, ni quota, ni écriture", async (provider) => {
    const a = await createUser("a");
    const d = deps();
    const apiKey = provider === "claude" ? CLAUDE_KEY : OPENAI_KEY;
    const error = (await settings.connectProvider(a.id, { provider, apiKey, activate: true }, d).catch((e: unknown) => e)) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.userMessage).toMatch(/n'est plus proposé dans Grand Oral Studio : choisissez Mistral, Gemini ou Sans IA\./);
    expect(error.fieldErrors?.provider?.[0]).toBe(error.userMessage);
    expect(d.verifyKey).not.toHaveBeenCalled();
    expect(await db().usageWindow.count()).toBe(0);
    expect(await db().userAiCredential.count()).toBe(0);
    expect(await db().userAiSettings.count()).toBe(0);
  });

  it("devrait refuser l'activation 1.1 de Claude, même avec une clé valide", async () => {
    const a = await createUser("a");
    const verifyKey = vi.fn(async () => ({ ok: true }) as const);
    const error = await settings.activateClaudeWithKey(a.id, { apiKey: CLAUDE_KEY }, { env: ENV, log: recordingLogger(), verifyKey }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toMatch(/^Claude n'est plus proposé/);
    expect(verifyKey).not.toHaveBeenCalled();
    expect(await db().userAiCredential.count()).toBe(0);
  });

  it.each([
    { engine: "claude", keySource: "user" },
    { engine: "claude", keySource: "server" },
    { engine: "openai", keySource: "server" },
  ] as const)("devrait refuser une nouvelle sélection (%o), même avec la clé disponible", async (input) => {
    const a = await createUser("a");
    await seedLegacyCredential(a.id, "claude", CLAUDE_KEY, ENV, null);
    await db().userAiSettings.create({ data: { userId: a.id, engine: "free" } });
    const env = { ...ENV, ANTHROPIC_API_KEY: "sk-ant-srv", OPENAI_API_KEY: "sk-team" };
    const error = (await settings.selectWriter(a.id, input, writerDeps(env)).catch((e: unknown) => e)) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors?.engine?.[0]).toMatch(/n'est plus proposé/);
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({ engine: "free" });
  });

  it("devrait refuser Claude par l'action 1.1 setEngine", async () => {
    const a = await createUser("a");
    await seedLegacyCredential(a.id, "claude", CLAUDE_KEY, ENV, null);
    await expect(settings.setEngine(a.id, { engine: "claude" }, writerDeps({ ...ENV, ANTHROPIC_API_KEY: "sk-ant-srv" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db().userAiSettings.count({ where: { engine: "claude" } })).toBe(0);
  });

  it("devrait honorer une sélection explicite héritée de Claude, la laisser tester puis supprimer (retour au défaut)", async () => {
    const a = await createUser("a");
    await seedLegacyCredential(a.id, "claude", CLAUDE_KEY, ENV);
    const env = { ...ENV, MISTRAL_API_KEY: "m-team" };
    const resolved = cloud(await getEngineForUser(a.id, { env, log: recordingLogger() }));
    expect(resolved).toMatchObject({ engine: "claude", keySource: "user", billing: "user" });
    // Revérifier la clé héritée reste possible (ce n'est pas une nouvelle connexion).
    const d = deps();
    await expect(settings.testConnection(a.id, { provider: "claude" }, d)).resolves.toMatchObject({ provider: "claude" });
    expect(d.verifyKey).toHaveBeenCalledWith("claude", CLAUDE_KEY);

    await settings.deleteConnection(a.id, { provider: "claude" }, { log: recordingLogger() });
    expect(await db().userAiCredential.count()).toBe(0);
    // Sans préférence : la clé d'équipe d'un fournisseur proposé, plus jamais Claude.
    expect(await getEngineForUser(a.id, { env: { ...env, ANTHROPIC_API_KEY: "sk-ant-srv" }, log: recordingLogger() })).toMatchObject({
      engine: "mistral",
      keySource: "server",
    });
  });

  it("devrait lister la connexion héritée dans la vue (pour la supprimer), sans carte d'équipe Claude ni OpenAI", async () => {
    const a = await createUser("a");
    await seedLegacyCredential(a.id, "openai", OPENAI_KEY, ENV, null);
    const view = await settings.getAiSettingsView(a.id, writerDeps({ ...ENV, ANTHROPIC_API_KEY: "sk-ant-srv", OPENAI_API_KEY: "sk-team" }));
    expect(view.connections.map((c) => c.provider)).toEqual(["openai"]);
    expect(view.team).toEqual([]);
    expect(view.effective).toMatchObject({ engine: "free", ready: true });
  });
});

describe("défaut sans préférence et démo (1.2)", () => {
  it.each([
    [{}, { engine: "free" }],
    [{ ANTHROPIC_API_KEY: "sk-ant-srv", OPENAI_API_KEY: "sk-team" }, { engine: "free" }],
    [{ GEMINI_API_KEY: "g-team" }, { engine: "gemini", keySource: "server", billing: "server" }],
    [{ GEMINI_API_KEY: "g-team", MISTRAL_API_KEY: "m-team" }, { engine: "mistral", keySource: "server", billing: "server" }],
  ] as const)("env %o → %o, même avec une clé Claude personnelle sans sélection", async (extra, expected) => {
    const a = await createUser("a");
    await seedLegacyCredential(a.id, "claude", CLAUDE_KEY, ENV, null);
    await settings.connectProvider(a.id, { provider: "mistral", apiKey: MISTRAL_KEY }, deps());
    expect(await getEngineForUser(a.id, { env: { ...ENV, ...extra }, log: recordingLogger() })).toMatchObject(expected);
  });

  it("devrait revenir à la démo (préférence effacée) seulement avec AI_PROVIDER=mock", async () => {
    const a = await createUser("a");
    await db().userAiSettings.create({ data: { userId: a.id, engine: "free", ollamaModel: "qwen2.5:14b" } });
    await expect(settings.selectWriter(a.id, { engine: "mock" }, writerDeps())).rejects.toBeInstanceOf(ValidationError);
    const mockEnv = { ...ENV, NODE_ENV: "development", AI_PROVIDER: "mock" };
    await settings.selectWriter(a.id, { engine: "mock" }, writerDeps(mockEnv));
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({
      engine: null,
      keySource: null,
      ollamaModel: "qwen2.5:14b",
    });
    expect((await getEngineForUser(a.id, { env: mockEnv, log: recordingLogger() })).engine).toBe("mock");
  });
});
