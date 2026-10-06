import { describe, expect, it } from "vitest";
import { toAiSetupStatus } from "@/components/settings/ai-status";
import type { AiSettingsView } from "@/server/repo/types";

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
