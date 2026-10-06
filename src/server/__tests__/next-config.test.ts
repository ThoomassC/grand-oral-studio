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

  it("devrait rediriger durablement l'ancienne page /parametres vers /configuration-ia", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual(
      expect.arrayContaining([
        { source: "/parametres", destination: "/configuration-ia", permanent: true },
        { source: "/parametres/:path*", destination: "/configuration-ia/:path*", permanent: true },
      ]),
    );
  });
  it("devrait rediriger durablement les anciennes pages d'un projet (charte, gabarit, squelettes) vers les nouvelles", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual(
      expect.arrayContaining([
        { source: "/projets/:id/charte", destination: "/projets/:id/apparence", permanent: true },
        { source: "/projets/:id/gabarit", destination: "/projets/:id/trame", permanent: true },
        { source: "/projets/:id/squelettes", destination: "/projets/:id/decks", permanent: true },
        { source: "/projets/:id/squelettes/:deckId", destination: "/projets/:id/decks/:deckId", permanent: true },
      ]),
    );
  });

  // 307 : la place reste libre pour une future page d'accueil du projet (pas de cache navigateur définitif).
  it("devrait ouvrir un projet sur son apparence par une redirection temporaire, déclarée en dernier", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const projects = redirects.filter((r) => r.source.startsWith("/projets/:id"));
    expect(projects.at(-1)).toEqual({ source: "/projets/:id", destination: "/projets/:id/apparence", permanent: false });
    expect(projects).toHaveLength(5);
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
