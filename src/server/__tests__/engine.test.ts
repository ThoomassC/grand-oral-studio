import { describe, expect, it } from "vitest";
import type { CloudProvider, EngineId, KeySource } from "@/domain/ai-providers";
import {
  billingFor,
  claudeAvailable,
  effectiveEngine,
  ollamaBaseUrl,
  planEngine,
  safePlanEngine,
  type EngineInputs,
  type EngineOverride,
} from "@/server/ai/engine";
import { AiKeyRequiredError, EngineUnavailableError } from "@/server/errors";

const prod = { NODE_ENV: "production" } as const;
const SERVER = { ANTHROPIC_API_KEY: "sk-ant-server" } as const;
const OLLAMA = { OLLAMA_BASE_URL: "http://localhost:11434/" } as const;

interface Over {
  selected?: EngineId | null;
  keySource?: KeySource | null;
  /** Raccourci 1.1 : une clé Claude personnelle est enregistrée. */
  hasUserKey?: boolean;
  connections?: CloudProvider[];
  ollamaModel?: string | null;
  env?: Record<string, string | undefined>;
  override?: EngineOverride | null;
}

const input = (over: Over = {}): EngineInputs => ({
  selection: { engine: over.selected ?? null, keySource: over.keySource ?? null },
  connections: over.connections ?? (over.hasUserKey ? ["claude"] : []),
  ollamaModel: over.ollamaModel ?? null,
  env: over.env ?? prod,
  override: over.override ?? null,
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

// ---------------------------------------------------------------------------
// 1.2 : fournisseurs cloud, origine de la clé, surcharge ponctuelle
// ---------------------------------------------------------------------------

const MISTRAL_TEAM = { MISTRAL_API_KEY: "mistral-team-key" } as const;

describe("planEngine — sélection héritée de la 1.1 (keySource NULL)", () => {
  it("devrait garder la règle 1.1 pour Claude choisi : clé personnelle, sinon clé du serveur", () => {
    expect(planEngine(input({ selected: "claude", hasUserKey: true, env: { ...prod, ...SERVER } }))).toEqual({ engine: "claude", keySource: "user" });
    expect(planEngine(input({ selected: "claude", env: { ...prod, ...SERVER } }))).toEqual({ engine: "claude", keySource: "server" });
  });

  it("ne devrait jamais choisir implicitement un autre fournisseur que Claude sans préférence", () => {
    expect(planEngine(input({ connections: ["mistral"], env: { ...prod, ...MISTRAL_TEAM } }))).toEqual({ engine: "free" });
  });

  it("devrait appliquer la même règle à un autre fournisseur choisi sans origine de clé", () => {
    expect(planEngine(input({ selected: "mistral", connections: ["mistral"] }))).toEqual({ engine: "mistral", keySource: "user" });
    expect(planEngine(input({ selected: "mistral", env: { ...prod, ...MISTRAL_TEAM } }))).toEqual({ engine: "mistral", keySource: "server" });
    expect(() => planEngine(input({ selected: "mistral" }))).toThrow(AiKeyRequiredError);
  });
});

describe("planEngine — origine de clé explicite", () => {
  it("devrait utiliser la clé personnelle choisie, sans repli sur la clé d'équipe", () => {
    expect(planEngine(input({ selected: "gemini", keySource: "user", connections: ["gemini"] }))).toEqual({ engine: "gemini", keySource: "user" });
    const error = (() => {
      try {
        planEngine(input({ selected: "gemini", keySource: "user", env: { ...prod, GEMINI_API_KEY: "g" } }));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(AiKeyRequiredError);
    expect((error as AiKeyRequiredError).userMessage).toMatch(/Gemini/);
  });

  it("devrait utiliser la clé d'équipe choisie même quand une clé personnelle existe", () => {
    expect(planEngine(input({ selected: "openai", keySource: "server", connections: ["openai"], env: { ...prod, OPENAI_API_KEY: "o" } }))).toEqual({
      engine: "openai",
      keySource: "server",
    });
  });

  it("devrait refuser la clé d'équipe absente du serveur, sans repli sur la clé personnelle", () => {
    expect(() => planEngine(input({ selected: "mistral", keySource: "server", connections: ["mistral"] }))).toThrow(EngineUnavailableError);
  });

  it("devrait remplacer la clé d'équipe Claude par le mock avec AI_PROVIDER=mock (dev/tests)", () => {
    expect(planEngine(input({ selected: "claude", keySource: "server", env: { AI_PROVIDER: "mock" } }))).toEqual({ engine: "mock" });
    expect(planEngine(input({ selected: "claude", keySource: "user", connections: ["claude"], env: { AI_PROVIDER: "mock" } }))).toEqual({
      engine: "claude",
      keySource: "user",
    });
    expect(() => planEngine(input({ selected: "mistral", keySource: "server", env: { AI_PROVIDER: "mock" } }))).toThrow(EngineUnavailableError);
  });
});

describe("planEngine — surcharge ponctuelle (repli en un clic)", () => {
  it("devrait primer sur la sélection enregistrée", () => {
    expect(planEngine(input({ selected: "claude", hasUserKey: true, override: { engine: "free" } }))).toEqual({ engine: "free" });
    expect(planEngine(input({ selected: "claude", hasUserKey: true, connections: ["claude", "mistral"], override: { engine: "mistral", keySource: "user" } }))).toEqual({
      engine: "mistral",
      keySource: "user",
    });
    expect(planEngine(input({ selected: "free", override: { engine: "mistral", keySource: "server" }, env: { ...prod, ...MISTRAL_TEAM } }))).toEqual({
      engine: "mistral",
      keySource: "server",
    });
  });

  it("ne devrait jamais basculer quand la surcharge est inutilisable", () => {
    expect(() => planEngine(input({ hasUserKey: true, override: { engine: "mistral", keySource: "user" } }))).toThrow(AiKeyRequiredError);
    expect(() => planEngine(input({ connections: ["openai"], override: { engine: "openai", keySource: "server" } }))).toThrow(EngineUnavailableError);
  });
});

describe("safePlanEngine / effectiveEngine / billingFor (1.2)", () => {
  it("devrait renvoyer l'erreur au lieu de lever", () => {
    const r = safePlanEngine(input({ selected: "mistral", keySource: "user" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(AiKeyRequiredError);
    expect(safePlanEngine(input())).toEqual({ ok: true, plan: { engine: "free" } });
  });

  it("devrait annoncer le fournisseur choisi même indisponible", () => {
    expect(effectiveEngine(input({ selected: "mistral", keySource: "user" }))).toBe("mistral");
    expect(effectiveEngine(input({ selected: "claude", keySource: "user", connections: ["claude"], env: { AI_PROVIDER: "mock" } }))).toBe("claude");
  });

  it("devrait facturer la clé personnelle à l'utilisateur et la clé d'équipe au serveur", () => {
    expect(billingFor({ engine: "mistral", keySource: "user" })).toBe("user");
    expect(billingFor({ engine: "gemini", keySource: "server" })).toBe("server");
  });
});
