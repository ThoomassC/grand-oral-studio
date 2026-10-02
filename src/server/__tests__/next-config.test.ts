import { describe, expect, it } from "vitest";
import nextConfig, { SERVER_ACTION_BODY_LIMIT } from "../../../next.config";
import { BRAND_FILE_MAX_BYTES } from "@/server/services/imports";
import { assertAiProviderEnv } from "@/server/ai/resolve";

describe("next.config", () => {
  // S1 : en dev, Next journalise les arguments des Server Actions — dont la clé API saisie.
  it("ne devrait pas journaliser les arguments des Server Functions", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
  });

  it("devrait accepter un fichier importé de 20 Mo dans une Server Action, avec une marge d'au plus 1 Mo", () => {
    const mb = /^(\d+)mb$/.exec(SERVER_ACTION_BODY_LIMIT);
    expect(mb).not.toBeNull();
    const limit = Number(mb![1]) * 1024 * 1024;
    expect(limit).toBeGreaterThan(BRAND_FILE_MAX_BYTES);
    expect(limit - BRAND_FILE_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024);
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(SERVER_ACTION_BODY_LIMIT);
    // Le proxy (/projets/**) tamponne le corps : sa limite doit suivre, sinon le fichier arrive tronqué.
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(SERVER_ACTION_BODY_LIMIT);
  });

  it("devrait rediriger durablement les anciennes adresses /programmes vers /projets", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual(
      expect.arrayContaining([
        { source: "/programmes", destination: "/projets", permanent: true },
        { source: "/programmes/:path*", destination: "/projets/:path*", permanent: true },
      ]),
    );
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
