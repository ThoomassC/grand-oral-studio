import { describe, expect, it } from "vitest";
import { parseChoice, retiredProvider, teamProvider, toAiSetupStatus } from "@/components/settings/ai-status";
import type { AiSettingsView } from "@/server/repo/types";

describe("toAiSetupStatus", () => {
  function view(overrides: Partial<AiSettingsView> = {}, ollamaConfigured = false): AiSettingsView {
    const ollama = { configured: ollamaConfigured, reachable: ollamaConfigured, models: ollamaConfigured ? ["mistral"] : [], selectedModel: null };
    return {
      connections: [],
      team: [],
      selection: { engine: null, keySource: null },
      effective: { engine: "free", keySource: null, model: null, ready: true, problem: null },
      mock: false,
      ollama,
      userKey: { configured: false, last4: null, updatedAt: null },
      effectiveSource: "none",
      model: "claude-opus-5-5",
      engine: {
        selected: null,
        effective: "free",
        available: { claude: false, ollama, free: true },
      },
      ...overrides,
    };
  }

  const MISTRAL = {
    provider: "mistral",
    last4: "9xQz",
    model: "mistral-small-latest",
    defaultModel: false,
    verifiedAt: "2026-10-06T08:00:00.000Z",
    updatedAt: "2026-10-05T08:00:00.000Z",
  } as const;

  it("devrait masquer Ollama quand le serveur ne le propose pas", () => {
    expect(toAiSetupStatus(view(), String).ollama).toBeNull();
    expect(toAiSetupStatus(view({}, true), String).ollama).toEqual({ reachable: true, models: ["mistral"], selectedModel: null });
  });

  it("ne devrait exposer d'une connexion que ses 4 derniers caractères, son modèle et ses dates formatées", () => {
    const s = toAiSetupStatus(view({ connections: [MISTRAL] }), (iso) => `le ${iso.slice(0, 10)}`);
    expect(s.connections).toEqual([
      {
        provider: "mistral",
        last4: "9xQz",
        model: "mistral-small-latest",
        modelLabel: "Mistral Small",
        verifiedAtLabel: "le 2026-10-06",
        addedAtLabel: "le 2026-10-05",
      },
    ]);
  });

  it("devrait ranger les connexions dans l'ordre des fournisseurs et signaler une clé jamais vérifiée", () => {
    const claude = { ...MISTRAL, provider: "claude", model: "claude-opus-5-5", verifiedAt: null } as const;
    const s = toAiSetupStatus(view({ connections: [MISTRAL, claude] }), String);
    expect(s.connections.map((c) => c.provider)).toEqual(["claude", "mistral"]);
    expect(s.connections[0]!.verifiedAtLabel).toBeNull();
  });

  it("devrait garder un modèle hors liste comme libellé, et retenir le défaut dans la liste fermée", () => {
    const claude = { ...MISTRAL, provider: "claude", model: "claude-ancien", defaultModel: true } as const;
    const [c] = toAiSetupStatus(view({ connections: [claude] }), String).connections;
    expect(c).toMatchObject({ model: "claude-opus-5-5", modelLabel: "claude-ancien" });
  });

  it("devrait proposer la clé d'équipe des seuls fournisseurs proposés, et la démo à part (plus de « Claude, clé de l'équipe »)", () => {
    expect(toAiSetupStatus(view({ team: ["claude", "mistral", "gemini", "openai"] }), String).team).toEqual(["mistral", "gemini"]);
    expect(toAiSetupStatus(view({ mock: true }), String)).toMatchObject({ team: [], demo: true });
    expect(toAiSetupStatus(view(), String).demo).toBe(false);
  });

  it("devrait garder une connexion héritée Claude ou OpenAI dans la liste (pour pouvoir la supprimer)", () => {
    const openai = { ...MISTRAL, provider: "openai", model: "gpt-5-mini" } as const;
    expect(toAiSetupStatus(view({ connections: [openai, MISTRAL] }), String).connections.map((c) => c.provider)).toEqual([
      "mistral",
      "openai",
    ]);
  });

  it("devrait traduire le choix enregistré en carte : clé personnelle, clé d'équipe, Ollama, Sans IA", () => {
    const saved = (selection: AiSettingsView["selection"], connections: AiSettingsView["connections"] = []) =>
      toAiSetupStatus(view({ selection, connections }), String).saved;
    expect(saved({ engine: "mistral", keySource: "user" })).toBe("mistral");
    expect(saved({ engine: "mistral", keySource: "server" })).toBe("team-mistral");
    expect(saved({ engine: "ollama", keySource: null })).toBe("ollama");
    expect(saved({ engine: "free", keySource: null })).toBe("free");
    // Choix de la 1.1 (origine non précisée) : la clé personnelle d'abord, sinon celle de l'équipe.
    expect(saved({ engine: "mistral", keySource: null }, [MISTRAL])).toBe("mistral");
    expect(saved({ engine: "claude", keySource: null })).toBe("team-claude");
  });

  it("devrait retenir, sans choix enregistré, le rédacteur que le serveur applique", () => {
    const effective = (engine: AiSettingsView["effective"]["engine"], keySource: AiSettingsView["effective"]["keySource"]) =>
      toAiSetupStatus(view({ effective: { engine, keySource, model: null, ready: true, problem: null } }), String).saved;
    expect(effective("mock", null)).toBe("demo");
    expect(effective("mistral", "server")).toBe("team-mistral");
    expect(effective("gemini", "server")).toBe("team-gemini");
    expect(effective("free", null)).toBe("free");
  });

  it("devrait présenter en démo une clé d'équipe Claude héritée que AI_PROVIDER=mock remplace", () => {
    const s = toAiSetupStatus(
      view({ selection: { engine: "claude", keySource: "server" }, effective: { engine: "mock", keySource: null, model: "mock", ready: true, problem: null } }),
      String,
    );
    expect(s.saved).toBe("demo");
  });
});

describe("parseChoice / teamProvider", () => {
  it("devrait accepter les seuls choix connus", () => {
    for (const raw of ["free", "demo", "ollama", "claude", "gemini", "team-openai"]) expect(parseChoice(raw)).toBe(raw);
    for (const raw of ["team-", "team-llama", "mock", "", null, 3]) expect(parseChoice(raw)).toBeNull();
  });

  it("devrait lire le fournisseur d'une carte « Clé de l'équipe »", () => {
    expect(teamProvider("team-mistral")).toBe("mistral");
    expect(teamProvider("mistral")).toBeNull();
    expect(teamProvider("free")).toBeNull();
  });

  it("devrait reconnaître un choix hérité d'un fournisseur qui n'est plus proposé", () => {
    expect(retiredProvider("claude")).toBe("claude");
    expect(retiredProvider("team-openai")).toBe("openai");
    for (const choice of ["mistral", "team-gemini", "free", "demo", "ollama"] as const) expect(retiredProvider(choice)).toBeNull();
  });
});
