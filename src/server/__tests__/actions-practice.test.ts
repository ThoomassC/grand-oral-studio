import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, RateLimitedError } from "@/server/errors";

/** Transport des actions d'entraînement : validation, quota, appel du dépôt, invalidation. */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("@/server/session", () => ({ requireUser: async () => ({ id: "u1", email: "lea@lycee.fr", name: "Léa" }) }));

const consumeQuota = vi.fn();
const consumeFreeEngineQuota = vi.fn();
vi.mock("@/server/rate-limit", () => ({
  consumeQuota: (...args: unknown[]) => consumeQuota(...args),
  consumeFreeEngineQuota: (...args: unknown[]) => consumeFreeEngineQuota(...args),
}));

const repo = { saveRehearsal: vi.fn(), setReview: vi.fn(), generate: vi.fn() };
vi.mock("@/server/repo/rehearsals", () => ({ saveRehearsal: (...a: unknown[]) => repo.saveRehearsal(...a) }));
vi.mock("@/server/repo/questions", () => ({ setReview: (...a: unknown[]) => repo.setReview(...a) }));
vi.mock("@/server/services/jury-questions", () => ({ generateJuryQuestions: (...a: unknown[]) => repo.generate(...a) }));

const actions = await import("@/server/actions/practice");

beforeEach(() => {
  for (const fn of [revalidatePath, consumeQuota, consumeFreeEngineQuota, ...Object.values(repo)]) fn.mockReset();
});

describe("saveRehearsal", () => {
  it("devrait enregistrer une saisie valide puis revalider le projet", async () => {
    const rehearsal = { id: "r1", totalSeconds: 20, perSlide: [10, 10], createdAt: "2026-10-07T08:00:00.000Z" };
    repo.saveRehearsal.mockResolvedValue({ programId: "p1", rehearsal });
    const result = await actions.saveRehearsal("d1", { totalSeconds: 20, perSlide: [10, 10] });
    expect(result).toEqual({ ok: true, data: { rehearsal } });
    expect(consumeQuota).toHaveBeenCalledWith("rehearsal:u1", 1, expect.objectContaining({ limit: 120 }), "user");
    expect(repo.saveRehearsal).toHaveBeenCalledWith("u1", "d1", { totalSeconds: 20, perSlide: [10, 10] });
    expect(revalidatePath).toHaveBeenCalledWith("/projets/p1", "layout");
  });

  it("devrait refuser une saisie incohérente avant tout quota", async () => {
    const result = await actions.saveRehearsal("d1", { totalSeconds: 10, perSlide: [60, 60] });
    expect(result).toMatchObject({ ok: false, fieldErrors: { perSlide: [expect.stringContaining("dépasse")] } });
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(repo.saveRehearsal).not.toHaveBeenCalled();
  });

  it("devrait traduire le quota atteint en message d'entraînement", async () => {
    consumeQuota.mockRejectedValue(new RateLimitedError(600));
    const result = await actions.saveRehearsal("d1", { totalSeconds: 20, perSlide: [10, 10] });
    expect(result).toEqual({ ok: false, error: "Trop d'enregistrements en peu de temps. Réessayez dans 10 min." });
  });
});

describe("setQuestionReview", () => {
  it("devrait marquer la question et revalider la page des questions", async () => {
    repo.setReview.mockResolvedValue({ programId: "p1", deckId: "d1", status: "known" });
    expect(await actions.setQuestionReview("q1", "known")).toEqual({ ok: true, data: { status: "known" } });
    expect(repo.setReview).toHaveBeenCalledWith("u1", "q1", "known");
    expect(revalidatePath).toHaveBeenCalledWith("/projets/p1/decks/d1/questions");
  });

  it("devrait refuser un statut inconnu", async () => {
    const result = await actions.setQuestionReview("q1", "maybe" as never);
    expect(result.ok).toBe(false);
    expect(repo.setReview).not.toHaveBeenCalled();
  });
});

describe("generateJuryQuestions", () => {
  it("devrait consommer le quota du moteur gratuit et renvoyer les questions", async () => {
    const questions = [{ id: "q1", question: "Q ?", answer: "R.", status: null }];
    repo.generate.mockResolvedValue({ programId: "p1", engine: "free", questions });
    expect(await actions.generateJuryQuestions("d1")).toEqual({ ok: true, data: { questions, engine: "free" } });
    expect(consumeFreeEngineQuota).toHaveBeenCalledWith("u1");
    expect(repo.generate).toHaveBeenCalledWith("u1", "d1");
  });

  it("devrait transmettre le refus d'un lecteur", async () => {
    repo.generate.mockRejectedValue(new ForbiddenError());
    expect(await actions.generateJuryQuestions("d1")).toEqual({
      ok: false,
      error: "Vous n'avez pas les droits pour cette action sur ce projet.",
    });
  });
});
