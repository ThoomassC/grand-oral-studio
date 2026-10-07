import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getEngineForUser } from "@/server/ai";
import { createMockProvider } from "@/server/ai/mock";
import type { OllamaModels } from "@/server/ai/ollama";
import type { AiProvider } from "@/server/ai/types";
import { db } from "@/server/db/client";
import {
  AiKeyRequiredError,
  AiUnavailableError,
  EngineUnavailableError,
  RateLimitedError,
  ValidationError,
} from "@/server/errors";
import { AI_GLOBAL_QUOTA_KEY, aiQuotaKey, FREE_ENGINE_QUOTA, freeQuotaKey } from "@/server/rate-limit";
import * as decks from "@/server/repo/decks";
import * as settings from "@/server/services/ai-settings";
import * as gen from "@/server/services/generation";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

const BASE = "http://localhost:11434";
const MASTER = randomBytes(32).toString("base64");
const PROD = { NODE_ENV: "production", SETTINGS_ENCRYPTION_KEY: MASTER } as const;
const WITH_OLLAMA = { ...PROD, OLLAMA_BASE_URL: `${BASE}/` } as const;
const KEY = `sk-ant-api03-${"k".repeat(60)}KKKK`;
const PROBLEM = "Comment réduire la consommation de données sur internet ?";

function ollamaProbe(result: OllamaModels) {
  return vi.fn<(baseUrl: string) => Promise<OllamaModels>>(async () => result);
}
const UP = { reachable: true, models: ["llama3.2:latest", "mistral:latest"] };

function engineDeps(env: Record<string, string | undefined>, probe = ollamaProbe(UP)) {
  return { env, log: recordingLogger(), listOllamaModels: probe };
}

/** Clé de l'utilisateur enregistrée (et Claude choisi) ; les tests fixent ensuite le moteur voulu. */
async function saveKey(userId: string, env: Record<string, string | undefined> = PROD) {
  await settings.activateClaudeWithKey(userId, { apiKey: KEY }, { env, log: recordingLogger(), verifyKey: async () => ({ ok: true }) });
}

async function count(key: string): Promise<number> {
  return (await db().usageWindow.findUnique({ where: { key } }))?.count ?? 0;
}

describe("setEngine — validation et stockage", () => {
  it("devrait enregistrer le moteur gratuit", async () => {
    const a = await createUser("a");
    await settings.setEngine(a.id, { engine: "free" }, engineDeps(PROD));
    const view = await settings.getAiSettingsView(a.id, engineDeps(PROD));
    expect(view.engine).toMatchObject({ selected: "free", effective: "free", available: { free: true, claude: false } });
  });

  it("devrait refuser Claude sans clé disponible, avec une erreur sur le champ engine", async () => {
    const a = await createUser("a");
    const error = (await settings.setEngine(a.id, { engine: "claude" }, engineDeps(PROD)).catch((e: unknown) => e)) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors?.engine?.[0]).toMatch(/clé API Anthropic/);
    expect(await db().userAiSettings.count()).toBe(0);
  });

  it("devrait accepter Claude avec la clé de l'utilisateur ou celle du serveur", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await saveKey(a.id);
    await settings.setEngine(a.id, { engine: "claude" }, engineDeps(PROD));
    await settings.setEngine(b.id, { engine: "claude" }, engineDeps({ ...PROD, ANTHROPIC_API_KEY: "sk-ant-srv" }));
    expect((await db().userAiSettings.findMany({ orderBy: { userId: "asc" } })).map((r) => r.engine)).toEqual(["claude", "claude"]);
  });

  it("devrait refuser Ollama quand le serveur ne le configure pas, sans sonder", async () => {
    const a = await createUser("a");
    const d = engineDeps(PROD);
    await expect(settings.setEngine(a.id, { engine: "ollama", ollamaModel: "mistral:latest" }, d)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(d.listOllamaModels).not.toHaveBeenCalled();
  });

  it("devrait refuser Ollama injoignable", async () => {
    const a = await createUser("a");
    const d = engineDeps(WITH_OLLAMA, ollamaProbe({ reachable: false, models: [] }));
    await expect(settings.setEngine(a.id, { engine: "ollama", ollamaModel: "mistral:latest" }, d)).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it("devrait refuser un modèle non installé, sans commande technique", async () => {
    const a = await createUser("a");
    const error = (await settings
      .setEngine(a.id, { engine: "ollama", ollamaModel: "qwen3:8b" }, engineDeps(WITH_OLLAMA))
      .catch((e: unknown) => e)) as ValidationError;
    expect(error.fieldErrors?.ollamaModel).toEqual(["Ce modèle n'est pas installé sur le serveur."]);
  });

  it("devrait enregistrer un modèle installé et sonder l'URL du serveur, jamais une URL fournie par le client", async () => {
    const a = await createUser("a");
    const d = engineDeps(WITH_OLLAMA);
    const hostile = { engine: "ollama", ollamaModel: "mistral:latest", baseUrl: "http://169.254.169.254" };
    await settings.setEngine(a.id, hostile, d);
    expect(d.listOllamaModels).toHaveBeenCalledWith(BASE);
    const row = await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } });
    expect(row).toMatchObject({ engine: "ollama", ollamaModel: "mistral:latest" });
    const view = await settings.getAiSettingsView(a.id, engineDeps(WITH_OLLAMA));
    expect(view.engine).toEqual({
      selected: "ollama",
      effective: "ollama",
      available: {
        claude: false,
        ollama: { configured: true, reachable: true, models: UP.models, selectedModel: "mistral:latest" },
        free: true,
      },
    });
  });

  it.each([{ engine: "gpt" }, { engine: "ollama" }, { engine: "ollama", ollamaModel: "../../etc" }, null, "free"])(
    "devrait refuser une entrée invalide (%o)",
    async (input) => {
      const a = await createUser("a");
      await expect(settings.setEngine(a.id, input, engineDeps(WITH_OLLAMA))).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it("ne devrait modifier que la ligne de l'appelant", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await saveKey(a.id);
    await settings.setEngine(a.id, { engine: "claude" }, engineDeps(PROD));
    await settings.setEngine(b.id, { engine: "free" }, engineDeps(PROD));
    expect((await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).engine).toBe("claude");
    expect((await settings.getAiSettingsView(b.id, engineDeps(PROD))).userKey.configured).toBe(false);
  });

  it("devrait conserver la préférence de moteur quand la clé est supprimée", async () => {
    const a = await createUser("a");
    await saveKey(a.id);
    await settings.setEngine(a.id, { engine: "free" }, engineDeps(PROD));
    await settings.deleteApiKey(a.id, { log: recordingLogger() });
    const row = await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } });
    expect(row).toMatchObject({ engine: "free", anthropicKeyCiphertext: null, anthropicKeyLast4: null, keyVersion: null });
  });
});

describe("getAiSettingsView — sonde Ollama", () => {
  it("ne devrait pas échouer quand Ollama est arrêté", async () => {
    const a = await createUser("a");
    const view = await settings.getAiSettingsView(a.id, engineDeps(WITH_OLLAMA, ollamaProbe({ reachable: false, models: [] })));
    expect(view.engine.available.ollama).toEqual({ configured: true, reachable: false, models: [], selectedModel: null });
    expect(view.engine.effective).toBe("free");
  });
});

describe("getEngineForUser — pas de bascule silencieuse", () => {
  it("devrait refuser Claude choisi quand la clé a disparu sans action de l'utilisateur (et sans clé serveur)", async () => {
    const a = await createUser("a");
    // Ligne « Claude choisi, aucune clé » (clé effacée hors de l'app) : pas de repli silencieux.
    await db().userAiSettings.create({ data: { userId: a.id, engine: "claude" } });
    await expect(getEngineForUser(a.id, { env: PROD, log: recordingLogger() })).rejects.toBeInstanceOf(AiKeyRequiredError);
  });

  it("devrait revenir au choix par défaut (sans IA) quand l'utilisateur supprime sa clé", async () => {
    const a = await createUser("a");
    await saveKey(a.id);
    await settings.setEngine(a.id, { engine: "claude" }, engineDeps(PROD));
    await settings.deleteApiKey(a.id, { log: recordingLogger() });
    expect((await getEngineForUser(a.id, { env: PROD, log: recordingLogger() })).engine).toBe("free");
  });

  it("devrait refuser Ollama choisi quand le serveur ne le configure plus", async () => {
    const a = await createUser("a");
    await settings.setEngine(a.id, { engine: "ollama", ollamaModel: "mistral:latest" }, engineDeps(WITH_OLLAMA));
    await expect(getEngineForUser(a.id, { env: PROD, log: recordingLogger() })).rejects.toBeInstanceOf(EngineUnavailableError);
  });

  it("devrait appeler Ollama à l'URL du serveur avec le modèle choisi", async () => {
    const a = await createUser("a");
    await settings.setEngine(a.id, { engine: "ollama", ollamaModel: "mistral:latest" }, engineDeps(WITH_OLLAMA));
    const calls: { url: string; model: unknown }[] = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), model: (JSON.parse(String(init?.body)) as { model: unknown }).model });
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    };
    const r = await getEngineForUser(a.id, { env: WITH_OLLAMA, fetch: fetchImpl, log: recordingLogger() });
    if (r.engine === "free") throw new Error("Ollama attendu");
    expect(r).toMatchObject({ engine: "ollama", billing: "local" });
    await expect(r.provider.classify({ system: "s", user: "u" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(calls).toEqual([{ url: `${BASE}/api/chat`, model: "mistral:latest" }]);
  });

  it("ne devrait pas déchiffrer la clé quand le moteur gratuit est choisi", async () => {
    const a = await createUser("a");
    await saveKey(a.id);
    await settings.setEngine(a.id, { engine: "free" }, engineDeps(PROD));
    // Clé maître absente : le déchiffrement échouerait — le moteur gratuit doit rester utilisable.
    expect(await getEngineForUser(a.id, { env: { NODE_ENV: "production" }, log: recordingLogger() })).toEqual({ engine: "free" });
  });
});

async function setupProgram() {
  const a = await createUser("a");
  const programId = await seedProgram(a.id);
  const [energie, numerique] = await seedThemes(programId, [
    themeInput("Transition énergétique", ["énergie", "climat"]),
    themeInput("Numérique", ["internet", "données", "réseaux"]),
  ]);
  return { a, programId, energie: energie!, numerique: numerique! };
}

const FREE = { mode: "free" as const, log: recordingLogger() };

describe("moteur gratuit — decks", () => {
  it("devrait produire un deck final « free » sans aucun quota IA, visible comme tel dans la liste", async () => {
    const { a, programId, numerique } = await setupProgram();
    const r = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, FREE);
    expect(r.warnings).toEqual([]);
    const deck = await decks.getDeck(a.id, r.deckId);
    expect(deck.engine).toBe("free");
    expect(deck.spec.slides.length).toBeGreaterThan(1);
    expect((await decks.listFinalDecks(a.id, programId)).map((d) => d.engine)).toEqual(["free"]);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
    expect(await count(AI_GLOBAL_QUOTA_KEY)).toBe(0);
    expect(await count(freeQuotaKey(a.id))).toBe(1);
  });

  it("devrait produire un deck final « free » sans sujet", async () => {
    const { a, programId } = await setupProgram();
    const r = await gen.generateFinalDeck(a.id, { programId, themeId: null, problem: PROBLEM }, FREE);
    expect(await decks.getDeck(a.id, r.deckId)).toMatchObject({ engine: "free", themeId: null });
  });

  it("devrait marquer le moteur IA sur un deck généré par IA", async () => {
    const { a, programId, numerique } = await setupProgram();
    const r = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, { ai: createMockProvider(), log: recordingLogger() });
    expect((await decks.getDeck(a.id, r.deckId)).engine).toBe("mock");
  });

  it("ne devrait pas réutiliser un deck gratuit quand on relance avec un moteur IA", async () => {
    const { a, programId, numerique } = await setupProgram();
    const free = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, FREE);
    const ai = await gen.generateFinalDeck(
      a.id,
      { programId, themeId: numerique, problem: PROBLEM },
      { ai: createMockProvider(), log: recordingLogger() },
    );
    expect(ai.reused).toBe(false);
    expect(ai.deckId).not.toBe(free.deckId);
    const again = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, FREE);
    expect(again).toMatchObject({ reused: true, deckId: free.deckId });
  });

  it("devrait appliquer une limite anti-abus légère", async () => {
    const { a, programId, numerique } = await setupProgram();
    await db().usageWindow.create({ data: { key: freeQuotaKey(a.id), windowStart: new Date(), count: FREE_ENGINE_QUOTA.limit } });
    await expect(gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, FREE)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("ne devrait pas permettre à B de générer sur le sujet de A", async () => {
    const { programId, numerique } = await setupProgram();
    const b = await createUser("b");
    await expect(gen.generateFinalDeck(b.id, { programId, themeId: numerique, problem: PROBLEM }, FREE)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

function failingAi(error: Error): AiProvider & { calls: number } {
  const mock = createMockProvider();
  const p = {
    name: "failing",
    engine: "claude" as const,
    calls: 0,
    generateDeck: mock.generateDeck,
    generateStructured: mock.generateStructured,
    async classify() {
      p.calls += 1;
      throw error;
    },
  };
  return p;
}

describe("reconnaissance du sujet — repli", () => {
  it("devrait reconnaître sans IA avec le moteur gratuit", async () => {
    const { a, programId, numerique } = await setupProgram();
    const r = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, FREE);
    expect(r).toMatchObject({ source: "free", fallbackReason: null });
    expect(r.ranked[0]!.themeId).toBe(numerique);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
  });

  it("devrait renvoyer source « ai » quand l'IA répond", async () => {
    const { a, programId } = await setupProgram();
    const r = await gen.classifyProblem(
      a.id,
      programId,
      { problem: PROBLEM, hintedThemeId: null },
      { ai: createMockProvider(), log: recordingLogger() },
    );
    expect(r.source).toBe("ai");
    expect(await count(aiQuotaKey(a.id))).toBe(1);
  });

  it("devrait se replier sur la reconnaissance sans IA quand l'IA est indisponible", async () => {
    const { a, programId, numerique } = await setupProgram();
    const ai = failingAi(new AiUnavailableError("down"));
    const r = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, { ai, log: recordingLogger() });
    expect(ai.calls).toBe(1);
    expect(r).toMatchObject({ source: "free", fallbackReason: new AiUnavailableError("down").userMessage });
    expect(r.ranked[0]!.themeId).toBe(numerique);
  });

  it("devrait transmettre la raison quand le moteur choisi est indisponible (mode gratuit de secours)", async () => {
    const { a, programId } = await setupProgram();
    const r = await gen.classifyProblem(
      a.id,
      programId,
      { problem: PROBLEM, hintedThemeId: null },
      { mode: "free", log: recordingLogger(), fallbackReason: "Ollama n'est pas configuré." },
    );
    expect(r).toMatchObject({ source: "free", fallbackReason: "Ollama n'est pas configuré." });
  });

  it("ne devrait jamais classer vers le sujet d'un autre utilisateur, même en repli", async () => {
    const { a, programId } = await setupProgram();
    const other = await setupProgram();
    const r = await gen.classifyProblem(
      a.id,
      programId,
      { problem: PROBLEM, hintedThemeId: other.numerique },
      { ai: failingAi(new AiUnavailableError("boom")), log: recordingLogger() },
    );
    expect(r.ranked.map((x) => x.themeId)).not.toContain(other.numerique);
  });
});

describe("contraintes de la base (moteurs)", () => {
  it("devrait refuser un moteur inconnu, Ollama sans modèle et une clé partielle", async () => {
    const a = await createUser("a");
    await expect(db().userAiSettings.create({ data: { userId: a.id, engine: "gpt" } })).rejects.toThrow();
    await expect(db().userAiSettings.create({ data: { userId: a.id, engine: "ollama" } })).rejects.toThrow();
    await expect(db().userAiSettings.create({ data: { userId: a.id, anthropicKeyLast4: "AAAA" } })).rejects.toThrow();
    await expect(db().userAiSettings.create({ data: { userId: a.id, engine: "free" } })).resolves.toBeTruthy();
  });

  it("devrait refuser un moteur de deck inconnu", async () => {
    const { a, programId, numerique } = await setupProgram();
    const r = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, FREE);
    await expect(db().deck.update({ where: { id: r.deckId }, data: { engine: "gpt" } })).rejects.toThrow();
  });
});
