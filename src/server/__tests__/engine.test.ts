import { describe, expect, it } from "vitest";
import { billingFor, claudeAvailable, effectiveEngine, ollamaBaseUrl, planEngine } from "@/server/ai/engine";
import { AiKeyRequiredError, EngineUnavailableError } from "@/server/errors";

const prod = { NODE_ENV: "production" } as const;
const SERVER = { ANTHROPIC_API_KEY: "sk-ant-server" } as const;
const OLLAMA = { OLLAMA_BASE_URL: "http://localhost:11434/" } as const;

const input = (over: Partial<Parameters<typeof planEngine>[0]> = {}) => ({
  selected: null,
  hasUserKey: false,
  ollamaModel: null,
  env: prod,
  ...over,
});

describe("planEngine — sans préférence", () => {
  it("devrait choisir Claude avec la clé de l'utilisateur", () => {
    expect(planEngine(input({ hasUserKey: true }))).toEqual({ engine: "claude", keySource: "user" });
  });

  it("devrait choisir Claude avec la clé du serveur", () => {
    expect(planEngine(input({ env: { ...prod, ...SERVER } }))).toEqual({ engine: "claude", keySource: "server" });
  });

  it("devrait choisir le moteur gratuit sans aucune clé, y compris en production", () => {
    expect(planEngine(input())).toEqual({ engine: "free" });
    expect(planEngine(input({ env: { NODE_ENV: "development" } }))).toEqual({ engine: "free" });
  });

  it("devrait utiliser le mock uniquement quand AI_PROVIDER=mock", () => {
    expect(planEngine(input({ env: { NODE_ENV: "development", AI_PROVIDER: "mock", ...SERVER } }))).toEqual({ engine: "mock" });
  });

  it("devrait garder la clé de l'utilisateur prioritaire sur AI_PROVIDER=mock", () => {
    expect(planEngine(input({ hasUserKey: true, env: { AI_PROVIDER: "mock" } }))).toEqual({ engine: "claude", keySource: "user" });
  });
});

describe("planEngine — moteur choisi", () => {
  it("devrait respecter le choix du moteur gratuit même avec une clé", () => {
    expect(planEngine(input({ selected: "free", hasUserKey: true }))).toEqual({ engine: "free" });
  });

  it("devrait refuser Claude sans clé, sans basculer vers un autre moteur", () => {
    expect(() => planEngine(input({ selected: "claude" }))).toThrow(AiKeyRequiredError);
  });

  it("devrait choisir Ollama avec l'URL du serveur (sans barre finale) et le modèle de l'utilisateur", () => {
    expect(planEngine(input({ selected: "ollama", ollamaModel: "mistral:latest", env: { ...prod, ...OLLAMA } }))).toEqual({
      engine: "ollama",
      baseUrl: "http://localhost:11434",
      model: "mistral:latest",
    });
  });

  it("devrait refuser Ollama quand le serveur ne le configure pas", () => {
    expect(() => planEngine(input({ selected: "ollama", ollamaModel: "mistral" }))).toThrow(EngineUnavailableError);
  });

  it("devrait refuser Ollama sans modèle choisi", () => {
    expect(() => planEngine(input({ selected: "ollama", env: OLLAMA }))).toThrow(EngineUnavailableError);
  });
});

describe("effectiveEngine (sans lever)", () => {
  it.each([
    [input(), "free"],
    [input({ hasUserKey: true }), "claude"],
    [input({ selected: "claude" }), "claude"],
    [input({ selected: "ollama" }), "ollama"],
    [input({ env: { AI_PROVIDER: "mock" } }), "mock"],
    [input({ selected: "claude", env: { AI_PROVIDER: "mock" } }), "mock"],
  ] as const)("%o → %s", (i, expected) => {
    expect(effectiveEngine(i)).toBe(expected);
  });
});

describe("claudeAvailable / ollamaBaseUrl / billingFor", () => {
  it("devrait dire Claude disponible avec une clé ou le mock imposé", () => {
    expect(claudeAvailable({ hasUserKey: true, env: prod })).toBe(true);
    expect(claudeAvailable({ hasUserKey: false, env: { ...prod, ...SERVER } })).toBe(true);
    expect(claudeAvailable({ hasUserKey: false, env: { AI_PROVIDER: "mock" } })).toBe(true);
    expect(claudeAvailable({ hasUserKey: false, env: prod })).toBe(false);
  });

  it.each([
    [undefined, null],
    ["", null],
    ["  ", null],
    ["file:///etc/passwd", null],
    ["pas une url", null],
    ["http://user:pass@localhost:11434", null],
    ["http://localhost:11434", "http://localhost:11434"],
    ["https://ollama.interne:443/", "https://ollama.interne"],
  ])("OLLAMA_BASE_URL=%o → %o", (value, expected) => {
    expect(ollamaBaseUrl({ OLLAMA_BASE_URL: value })).toBe(expected);
  });

  it("devrait facturer selon le moteur", () => {
    expect(billingFor({ engine: "claude", keySource: "user" })).toBe("user");
    expect(billingFor({ engine: "claude", keySource: "server" })).toBe("server");
    expect(billingFor({ engine: "mock" })).toBe("server");
    expect(billingFor({ engine: "ollama", baseUrl: "http://x", model: "m" })).toBe("local");
  });
});

// B1 : AI_PROVIDER inconnu ne doit pas casser les moteurs qui n'utilisent pas Claude.
describe("AI_PROVIDER invalide", () => {
  const bad = { NODE_ENV: "production", AI_PROVIDER: "ollama", ...OLLAMA } as const;

  it("ne devrait pas empêcher les moteurs gratuit et Ollama", () => {
    expect(planEngine(input({ selected: "free", env: bad }))).toEqual({ engine: "free" });
    expect(planEngine(input({ selected: "ollama", ollamaModel: "m", env: bad }))).toMatchObject({ engine: "ollama" });
  });

  it("ne devrait pas lever dans les fonctions d'affichage", () => {
    expect(() => effectiveEngine(input({ env: bad }))).not.toThrow();
    expect(claudeAvailable({ hasUserKey: false, env: bad })).toBe(false);
  });
});
