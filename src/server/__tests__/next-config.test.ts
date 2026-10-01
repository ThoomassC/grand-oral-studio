import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { assertAiProviderEnv } from "@/server/ai/resolve";

describe("next.config", () => {
  // S1 : en dev, Next journalise les arguments des Server Actions — dont la clé API saisie.
  it("ne devrait pas journaliser les arguments des Server Functions", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
  });
});

describe("assertAiProviderEnv (validation au démarrage)", () => {
  it.each([undefined, "", "mock", "anthropic", " Mock "])("devrait accepter AI_PROVIDER=%o", (value) => {
    expect(() => assertAiProviderEnv({ AI_PROVIDER: value })).not.toThrow();
  });

  it("devrait refuser une valeur inconnue avec un message explicite", () => {
    expect(() => assertAiProviderEnv({ AI_PROVIDER: "ollama" })).toThrow(
      "AI_PROVIDER doit valoir anthropic ou mock ; pour Ollama, utilisez OLLAMA_BASE_URL.",
    );
  });
});
