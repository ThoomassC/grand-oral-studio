import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiInvalidOutputError, AiUnavailableError, ForbiddenError, RateLimitedError } from "@/server/errors";

/** Transport des actions d'entraînement : validation, quota, appel du dépôt, invalidation. */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("@/server/session", () => ({ requireUser: async () => ({ id: "u1", email: "lea@lycee.fr", name: "Léa" }) }));

const consumeQuota = vi.fn();
const consumeFreeEngineQuota = vi.fn();
const consumeAiQuotaFor = vi.fn();
const refundAiQuotaFor = vi.fn();
vi.mock("@/server/rate-limit", () => ({
  consumeQuota: (...args: unknown[]) => consumeQuota(...args),
  consumeFreeEngineQuota: (...args: unknown[]) => consumeFreeEngineQuota(...args),
  consumeAiQuotaFor: (...args: unknown[]) => consumeAiQuotaFor(...args),
  refundAiQuotaFor: (...args: unknown[]) => refundAiQuotaFor(...args),
}));

type Generator = { engine: string; generate: (input: unknown) => Promise<unknown> };
const getEngineForUser = vi.fn();
vi.mock("@/server/ai", () => ({ getEngineForUser: (...a: unknown[]) => getEngineForUser(...a) }));

const repo = { saveRehearsal: vi.fn(), setReview: vi.fn(), generate: vi.fn(), getDeck: vi.fn(), generatorFor: vi.fn() };
vi.mock("@/server/repo/rehearsals", () => ({ saveRehearsal: (...a: unknown[]) => repo.saveRehearsal(...a) }));
vi.mock("@/server/repo/questions", () => ({ setReview: (...a: unknown[]) => repo.setReview(...a) }));
vi.mock("@/server/repo/decks", () => ({ getDeck: (...a: unknown[]) => repo.getDeck(...a) }));
vi.mock("@/server/services/jury-questions", () => ({
  generateJuryQuestions: (...a: unknown[]) => repo.generate(...a),
  juryQuestionsGeneratorFor: (...a: unknown[]) => repo.generatorFor(...a),
}));

/** Le service simulé appelle le générateur reçu, comme le vrai (après sa lecture des droits). */
function serviceCallsGenerator(output: { programId: string; engine: string; questions: unknown[] }) {
  repo.generate.mockImplementation(async (_u: string, _d: string, deps: { generator: Generator }) => {
    await deps.generator.generate({ spec: {}, subject: null });
    return { ...output, engine: deps.generator.engine };
  });
}

const actions = await import("@/server/actions/practice");

beforeEach(() => {
  for (const fn of [
    revalidatePath,
    consumeQuota,
    consumeFreeEngineQuota,
    consumeAiQuotaFor,
    refundAiQuotaFor,
    getEngineForUser,
    ...Object.values(repo),
  ]) {
    fn.mockReset();
  }
  getEngineForUser.mockResolvedValue({ engine: "free" });
  repo.getDeck.mockResolvedValue({ problem: "Comment concilier mobilité et sobriété ?", spec: { subtitle: "" }, program: { template: { language: "fr" } } });
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
  const questions = [{ id: "q1", question: "Q ?", answer: "R.", status: null }];

  it("Sans IA : devrait consommer le quota du moteur gratuit et renvoyer les questions", async () => {
    repo.generatorFor.mockReturnValue({ engine: "free", generate: async () => ({ questions: [] }) });
    serviceCallsGenerator({ programId: "p1", engine: "free", questions });

    expect(await actions.generateJuryQuestions("d1")).toEqual({ ok: true, data: { questions, engine: "free" } });
    expect(consumeFreeEngineQuota).toHaveBeenCalledWith("u1");
    expect(consumeAiQuotaFor).not.toHaveBeenCalled();
    expect(repo.generatorFor).toHaveBeenCalledWith({ engine: "free" }, expect.anything());
    expect(revalidatePath).toHaveBeenCalledWith("/projets/p1", "layout");
  });

  it("IA : devrait consommer le quota IA de la facturation du rédacteur et transmettre la problématique", async () => {
    const resolved = { engine: "mistral", provider: { name: "mistral" }, billing: "user", keySource: "user", model: "m" };
    getEngineForUser.mockResolvedValue(resolved);
    repo.generatorFor.mockReturnValue({ engine: "mistral", generate: async () => ({ questions: [] }) });
    serviceCallsGenerator({ programId: "p1", engine: "mistral", questions });

    expect(await actions.generateJuryQuestions("d1")).toEqual({ ok: true, data: { questions, engine: "mistral" } });
    expect(consumeAiQuotaFor).toHaveBeenCalledWith("user", "u1", 1);
    expect(consumeFreeEngineQuota).not.toHaveBeenCalled();
    expect(repo.generatorFor).toHaveBeenCalledWith(resolved, { problem: "Comment concilier mobilité et sobriété ?", language: "fr" });
  });

  it("IA indisponible sans calcul : devrait restituer le quota et afficher l'erreur, sans repli sans IA", async () => {
    getEngineForUser.mockResolvedValue({ engine: "claude", provider: { name: "claude" }, billing: "server", keySource: "server", model: "m" });
    repo.generatorFor.mockReturnValue({
      engine: "claude",
      generate: async () => {
        throw new AiUnavailableError("down", { refundable: true });
      },
    });
    serviceCallsGenerator({ programId: "p1", engine: "claude", questions });

    const result = await actions.generateJuryQuestions("d1");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("momentanément indisponible") });
    expect(refundAiQuotaFor).toHaveBeenCalledWith("server", "u1", 1);
    expect(consumeFreeEngineQuota).not.toHaveBeenCalled();
    expect(repo.generatorFor).toHaveBeenCalledTimes(1);
  });

  it("IA hors contrat : ne devrait pas restituer le quota (le calcul a eu lieu)", async () => {
    getEngineForUser.mockResolvedValue({ engine: "claude", provider: { name: "claude" }, billing: "server", keySource: "server", model: "m" });
    repo.generatorFor.mockReturnValue({ engine: "claude", generate: async () => ({ questions: [] }) });
    repo.generate.mockRejectedValue(new AiInvalidOutputError("juryQuestions"));
    expect((await actions.generateJuryQuestions("d1")).ok).toBe(false);
    expect(refundAiQuotaFor).not.toHaveBeenCalled();
  });

  it("devrait afficher l'erreur d'un rédacteur inutilisable au lieu de passer en Sans IA", async () => {
    getEngineForUser.mockRejectedValue(new RateLimitedError(60));
    expect((await actions.generateJuryQuestions("d1")).ok).toBe(false);
    expect(repo.generate).not.toHaveBeenCalled();
  });

  it("devrait transmettre le refus d'un lecteur", async () => {
    repo.generatorFor.mockReturnValue({ engine: "free", generate: async () => ({ questions: [] }) });
    repo.generate.mockRejectedValue(new ForbiddenError());
    expect(await actions.generateJuryQuestions("d1")).toEqual({
      ok: false,
      error: "Vous n'avez pas les droits pour cette action sur ce projet.",
    });
    expect(consumeFreeEngineQuota).not.toHaveBeenCalled();
  });
});
