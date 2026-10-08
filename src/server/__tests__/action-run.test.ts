import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderRateLimitedError, RateLimitedError, UnauthenticatedError, ValidationError } from "@/server/errors";
import { runAction } from "@/server/actions/run";

/** Enveloppe des Server Actions : traduction des erreurs attendues, dont l'attente d'un quota. */

vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));
let signedIn = true;
vi.mock("@/server/session", () => ({
  requireUser: async () => {
    if (!signedIn) throw new UnauthenticatedError();
    return { id: "user-1", email: "u@example.test", name: "U" };
  },
}));

beforeEach(() => {
  signedIn = true;
});

describe("runAction", () => {
  it("devrait renvoyer les données d'une action réussie", async () => {
    await expect(runAction("test", async () => 42)).resolves.toEqual({ ok: true, data: 42 });
  });

  it("devrait exposer l'attente d'une limite du fournisseur d'IA (AI_RATE_LIMITED), avec le code si demandé", async () => {
    const result = await runAction(
      "test",
      async () => {
        throw new AiProviderRateLimitedError("mistral", 90);
      },
      { exposeCode: true },
    );
    expect(result).toMatchObject({ ok: false, code: "AI_RATE_LIMITED", retryAfterSeconds: 90 });
  });

  it("devrait exposer l'attente d'un quota (RATE_LIMITED) arrondie à la seconde, même sans exposeCode", async () => {
    const result = await runAction("test", async () => {
      throw new RateLimitedError(119.2);
    });
    expect(result).toEqual({ ok: false, error: "Trop de générations en peu de temps. Réessayez dans 2 min.", retryAfterSeconds: 120 });
  });

  it("ne devrait pas exposer d'attente nulle ni pour une autre erreur attendue", async () => {
    const zero = await runAction("test", async () => {
      throw new RateLimitedError(0);
    });
    expect(zero).not.toHaveProperty("retryAfterSeconds");
    const invalid = await runAction("test", async () => {
      throw new ValidationError("Champ invalide.");
    });
    expect(invalid).not.toHaveProperty("retryAfterSeconds");
  });

  it("ne devrait jamais renvoyer le message brut d'une panne", async () => {
    const result = await runAction("test", async () => {
      throw new Error("secret interne");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("secret interne");
      expect(result).not.toHaveProperty("retryAfterSeconds");
    }
  });
});
