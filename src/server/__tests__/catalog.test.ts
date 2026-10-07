import { describe, expect, it } from "vitest";
import { CLOUD_PROVIDERS, isKnownModel, PROVIDER_INFO } from "@/domain/ai-providers";
import { apiKeyMatches, modelFor, PROVIDER_CATALOG, teamKey, teamKeyProviders } from "@/server/ai/catalog";

describe("catalogue des fournisseurs", () => {
  it("devrait fixer les URL de base côté serveur (https, sans identifiants, jamais saisies)", () => {
    expect(PROVIDER_CATALOG.mistral.baseUrl).toBe("https://api.mistral.ai/v1");
    expect(PROVIDER_CATALOG.gemini.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(PROVIDER_CATALOG.openai.baseUrl).toBe("https://api.openai.com/v1");
    for (const p of CLOUD_PROVIDERS) {
      const url = new URL(PROVIDER_CATALOG[p].baseUrl);
      expect(url.protocol).toBe("https:");
      expect(url.username + url.password).toBe("");
      expect(PROVIDER_CATALOG[p].baseUrl.endsWith("/")).toBe(false);
    }
    expect(Object.isFrozen(PROVIDER_CATALOG)).toBe(true);
  });

  it("devrait associer un protocole, un mode de sortie structurée et une variable de clé d'équipe", () => {
    expect(PROVIDER_CATALOG.claude).toMatchObject({ protocol: "anthropic", teamKeyEnv: "ANTHROPIC_API_KEY" });
    expect(PROVIDER_CATALOG.mistral).toMatchObject({ protocol: "openai-compatible", teamKeyEnv: "MISTRAL_API_KEY", structured: "json_schema" });
    expect(PROVIDER_CATALOG.gemini).toMatchObject({ protocol: "openai-compatible", teamKeyEnv: "GEMINI_API_KEY" });
    expect(PROVIDER_CATALOG.openai).toMatchObject({ protocol: "openai-compatible", teamKeyEnv: "OPENAI_API_KEY", structured: "json_schema" });
  });

  it("devrait reprendre les informations publiques du domaine", () => {
    for (const p of CLOUD_PROVIDERS) {
      expect(PROVIDER_CATALOG[p]).toMatchObject(PROVIDER_INFO[p]);
      expect(isKnownModel(p, PROVIDER_INFO[p].defaultModel)).toBe(true);
    }
  });

  it("ne devrait exposer côté client ni URL d'API, ni variable d'environnement, ni motif de clé", () => {
    const json = JSON.stringify(PROVIDER_INFO);
    expect(json).not.toMatch(/api\.mistral\.ai|googleapis|api\.openai\.com|_API_KEY/);
    expect(Object.keys(PROVIDER_INFO.mistral)).not.toContain("baseUrl");
  });

  it("devrait indiquer les paliers gratuits et l'hébergement européen", () => {
    expect(CLOUD_PROVIDERS.filter((p) => PROVIDER_INFO[p].free)).toEqual(["mistral", "gemini"]);
    expect(CLOUD_PROVIDERS.filter((p) => PROVIDER_INFO[p].data.euHosted)).toEqual(["mistral"]);
  });
});

describe("apiKeyMatches", () => {
  it.each([
    ["claude", `sk-ant-api03-${"a".repeat(40)}`, true],
    ["claude", "sk-proj-abc", false],
    ["mistral", "A".repeat(32), true],
    ["mistral", "court", false],
    ["mistral", `${"a".repeat(20)} ${"b".repeat(20)}`, false],
    ["gemini", `AIza${"x".repeat(35)}`, true],
    ["gemini", `sk-${"x".repeat(35)}`, false],
    ["openai", `sk-proj-${"x".repeat(40)}`, true],
    ["openai", `sk-${"x".repeat(48)}`, true],
    ["openai", "AIza-pas-openai", false],
  ] as const)("%s %s → %s", (provider, key, expected) => {
    expect(apiKeyMatches(provider, key)).toBe(expected);
  });
});

describe("teamKey / teamKeyProviders / modelFor", () => {
  it("devrait lire la clé d'équipe dans la variable du fournisseur (vide = absente)", () => {
    const env = { MISTRAL_API_KEY: "  m-key  ", GEMINI_API_KEY: " ", ANTHROPIC_API_KEY: "sk-ant-srv" };
    expect(teamKey("mistral", env)).toBe("m-key");
    expect(teamKey("gemini", env)).toBeNull();
    expect(teamKey("openai", env)).toBeNull();
    expect(teamKeyProviders(env)).toEqual(["claude", "mistral"]);
  });

  it("devrait choisir le modèle enregistré s'il est connu, sinon le modèle par défaut", () => {
    expect(modelFor("mistral", "mistral-small-latest", {})).toBe("mistral-small-latest");
    expect(modelFor("mistral", "modele-inconnu", {})).toBe("mistral-large-latest");
    expect(modelFor("openai", null, {})).toBe("gpt-5-mini");
  });

  it("devrait garder AI_MODEL pour Claude sans modèle enregistré", () => {
    expect(modelFor("claude", null, { AI_MODEL: "claude-x" })).toBe("claude-x");
    expect(modelFor("claude", null, {})).toBe("claude-opus-5-5");
    expect(modelFor("claude", "claude-opus-5-5", { AI_MODEL: "claude-x" })).toBe("claude-opus-5-5");
  });
});
