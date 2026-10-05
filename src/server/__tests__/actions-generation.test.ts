import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Couche de transport des actions de génération : on isole Next (cache,
 * navigation), la session et le service, pour vérifier ce que l'action fait
 * de leurs résultats (revalidation, paramètres transmis).
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("@/server/session", () => ({
  requireUser: async () => ({ id: "user-1", email: "u@example.test", name: "U" }),
}));
type Resolved = { engine: "free" } | { engine: string; provider: { name: string }; billing: string };
const getEngineForUser = vi.fn<(userId: string) => Promise<Resolved>>(async () => ({
  engine: "mock",
  provider: { name: "mock" },
  billing: "server",
}));
vi.mock("@/server/ai", () => ({ getEngineForUser: (userId: string) => getEngineForUser(userId) }));

const service = {
  generateFinalDeck: vi.fn(),
  classifyProblem: vi.fn(),
};
vi.mock("@/server/services/generation", () => ({
  generateFinalDeck: (...args: unknown[]) => service.generateFinalDeck(...args),
  classifyProblem: (...args: unknown[]) => service.classifyProblem(...args),
}));

const actions = await import("@/server/actions/generation");

const PROBLEM = "Comment concilier mobilité et sobriété en ville ?";

beforeEach(() => {
  revalidatePath.mockReset();
  service.generateFinalDeck.mockReset();
  service.classifyProblem.mockReset();
});

describe("action generateFinalDeck", () => {
  it("devrait transmettre le sujet et revalider les pages du projet", async () => {
    service.generateFinalDeck.mockResolvedValue({ deckId: "deck-1", warnings: [], reused: false });
    const result = await actions.generateFinalDeck("prog-1", "theme-1", PROBLEM);
    expect(result).toEqual({ ok: true, data: { deckId: "deck-1" } });
    expect(service.generateFinalDeck.mock.calls[0]![1]).toEqual({ programId: "prog-1", themeId: "theme-1", problem: PROBLEM });
    expect(revalidatePath).toHaveBeenCalledWith("/projets/prog-1", "layout");
  });

  it("devrait accepter un deck sans sujet (themeId null)", async () => {
    service.generateFinalDeck.mockResolvedValue({ deckId: "deck-2", warnings: [], reused: false });
    const result = await actions.generateFinalDeck("prog-1", null, PROBLEM);
    expect(result).toEqual({ ok: true, data: { deckId: "deck-2" } });
    expect(service.generateFinalDeck.mock.calls[0]![1]).toEqual({ programId: "prog-1", themeId: null, problem: PROBLEM });
  });

  it.each([
    { label: "un chemin", themeId: "../x" },
    { label: "une chaîne vide", themeId: "" },
    { label: "undefined (ni sujet ni null explicite)", themeId: undefined },
  ])("devrait refuser un identifiant de sujet invalide : $label", async ({ themeId }) => {
    const result = await actions.generateFinalDeck("prog-1", themeId as unknown as string | null, PROBLEM);
    expect(result.ok).toBe(false);
    expect(service.generateFinalDeck).not.toHaveBeenCalled();
  });

  it("devrait refuser une problématique trop courte sans appeler le service", async () => {
    const result = await actions.generateFinalDeck("prog-1", null, "Ok ?");
    expect(result.ok).toBe(false);
    expect(service.generateFinalDeck).not.toHaveBeenCalled();
  });

  it("ne devrait plus exposer la génération de squelettes", () => {
    expect(Object.keys(actions).sort()).toEqual(["classifyProblem", "generateFinalDeck"]);
  });
});

describe("choix du moteur et de la facturation", () => {
  it("devrait résoudre le moteur de l'utilisateur connecté et transmettre fournisseur et facturation", async () => {
    getEngineForUser.mockResolvedValueOnce({ engine: "claude", provider: { name: "anthropic:x" }, billing: "user" });
    service.generateFinalDeck.mockResolvedValue({ deckId: "d", warnings: [], reused: false });
    await actions.generateFinalDeck("prog-1", "theme-1", PROBLEM);
    expect(getEngineForUser).toHaveBeenCalledWith("user-1");
    expect(service.generateFinalDeck.mock.calls[0]![2]).toMatchObject({ billing: "user", ai: { name: "anthropic:x" } });
  });

  it("devrait passer en mode gratuit quand le moteur gratuit est retenu", async () => {
    getEngineForUser.mockResolvedValueOnce({ engine: "free" });
    service.generateFinalDeck.mockResolvedValue({ deckId: "d", warnings: [], reused: false });
    await actions.generateFinalDeck("prog-1", null, PROBLEM);
    expect(service.generateFinalDeck.mock.calls[0]![2]).toMatchObject({ mode: "free" });
  });

  it("devrait renvoyer le message Configuration IA quand le moteur choisi est indisponible (pas de bascule)", async () => {
    const { AiKeyRequiredError } = await import("@/server/errors");
    getEngineForUser.mockRejectedValueOnce(new AiKeyRequiredError());
    const result = await actions.generateFinalDeck("prog-1", "theme-1", PROBLEM);
    expect(result).toEqual({
      ok: false,
      error: "Ajoutez votre clé API Anthropic dans la Configuration IA pour lancer une génération.",
    });
    expect(service.generateFinalDeck).not.toHaveBeenCalled();
  });

  it("devrait reconnaître sans IA (avec la raison) quand le moteur choisi est indisponible le jour J", async () => {
    const { EngineUnavailableError } = await import("@/server/errors");
    getEngineForUser.mockRejectedValueOnce(new EngineUnavailableError("Ollama n'est pas configuré sur ce serveur."));
    service.classifyProblem.mockResolvedValue({ reformulatedProblem: "x", ranked: [], source: "free", fallbackReason: "r" });
    const result = await actions.classifyProblem("prog-1", { problem: "Une problématique assez longue ?" });
    expect(result.ok).toBe(true);
    expect(service.classifyProblem.mock.calls[0]![3]).toMatchObject({
      mode: "free",
      fallbackReason: "Ollama n'est pas configuré sur ce serveur.",
    });
  });
});
