import { describe, expect, it } from "vitest";
import { isReady, toAiSetupStatus, writerLabel, type AiSetupStatus } from "@/components/settings/ai-status";
import type { AiSettingsView } from "@/server/repo/types";

function status(overrides: Partial<AiSetupStatus> = {}, claude: Partial<AiSetupStatus["claude"]> = {}): AiSetupStatus {
  return {
    selected: null,
    effective: "free",
    ollama: null,
    ...overrides,
    claude: { available: false, source: "none", userKey: null, ...claude },
  };
}

const OLLAMA = { reachable: true, models: ["llama3.2", "mistral"], selectedModel: "mistral" };

describe("isReady", () => {
  it("devrait toujours être prêt Sans IA", () => {
    expect(isReady(status({ selected: "free", effective: "free" }))).toBe(true);
  });

  it("ne devrait pas être prêt avec Claude sans clé", () => {
    expect(isReady(status({ selected: "claude", effective: "claude" }))).toBe(false);
  });

  it("devrait être prêt avec Claude et une clé (personnelle ou du serveur)", () => {
    expect(isReady(status({ selected: "claude", effective: "claude" }, { available: true, source: "user" }))).toBe(true);
    expect(isReady(status({ selected: null, effective: "claude" }, { available: true, source: "server" }))).toBe(true);
  });

  it("devrait être prêt en démonstration", () => {
    expect(isReady(status({ selected: "claude", effective: "mock" }, { available: true, source: "mock" }))).toBe(true);
  });

  it("ne devrait être prêt avec Ollama que joignable et avec le modèle choisi installé", () => {
    const base = { selected: "ollama", effective: "ollama" } as const;
    expect(isReady(status({ ...base, ollama: OLLAMA }))).toBe(true);
    expect(isReady(status({ ...base, ollama: { ...OLLAMA, selectedModel: "qwen3:8b" } }))).toBe(false);
    expect(isReady(status({ ...base, ollama: { ...OLLAMA, selectedModel: null } }))).toBe(false);
    expect(isReady(status({ ...base, ollama: { ...OLLAMA, reachable: false } }))).toBe(false);
    expect(isReady(status({ ...base, ollama: null }))).toBe(false);
  });
});

describe("writerLabel", () => {
  it("devrait nommer qui rédige, en mots d'utilisateur", () => {
    expect(writerLabel(status({ effective: "free" }))).toBe("Sans IA");
    expect(writerLabel(status({ effective: "claude" }))).toBe("Claude");
    expect(writerLabel(status({ effective: "mock" }))).toBe("Démo (contenus factices)");
    expect(writerLabel(status({ effective: "ollama", ollama: OLLAMA }))).toBe("Ollama · mistral");
    expect(writerLabel(status({ effective: "ollama", ollama: { ...OLLAMA, selectedModel: null } }))).toBe("Ollama");
  });
});

describe("toAiSetupStatus", () => {
  function view(overrides: Partial<AiSettingsView> = {}, ollamaConfigured = false): AiSettingsView {
    return {
      userKey: { configured: false, last4: null, updatedAt: null },
      effectiveSource: "none",
      model: "claude-opus-5-5",
      engine: {
        selected: null,
        effective: "free",
        available: {
          claude: false,
          ollama: { configured: ollamaConfigured, reachable: ollamaConfigured, models: ollamaConfigured ? ["mistral"] : [], selectedModel: null },
          free: true,
        },
      },
      ...overrides,
    };
  }

  it("devrait masquer Ollama quand le serveur ne le propose pas", () => {
    expect(toAiSetupStatus(view(), String).ollama).toBeNull();
    expect(toAiSetupStatus(view({}, true), String).ollama).toEqual({ reachable: true, models: ["mistral"], selectedModel: null });
  });

  it("ne devrait exposer de la clé que ses 4 derniers caractères et sa date formatée", () => {
    const s = toAiSetupStatus(
      view({
        userKey: { configured: true, last4: "4f2a", updatedAt: "2026-10-05T08:00:00.000Z" },
        effectiveSource: "user",
        engine: { ...view().engine, selected: "claude", effective: "claude", available: { ...view().engine.available, claude: true } },
      }),
      (iso) => `le ${iso.slice(0, 10)}`,
    );
    expect(s).toEqual({
      selected: "claude",
      effective: "claude",
      claude: { available: true, source: "user", userKey: { last4: "4f2a", addedAtLabel: "le 2026-10-05" } },
      ollama: null,
    });
  });

  it("ne devrait pas inventer de clé utilisateur quand il n'y en a pas", () => {
    const s = toAiSetupStatus(view({ effectiveSource: "server" }), String);
    expect(s.claude).toEqual({ available: false, source: "server", userKey: null });
  });
});
