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
  generateSkeleton: vi.fn(),
  generateAllSkeletons: vi.fn(),
  classifyProblem: vi.fn(),
};
vi.mock("@/server/services/generation", () => ({
  generateSkeleton: (...args: unknown[]) => service.generateSkeleton(...args),
  generateAllSkeletons: (...args: unknown[]) => service.generateAllSkeletons(...args),
  classifyProblem: (...args: unknown[]) => service.classifyProblem(...args),
}));

const actions = await import("@/server/actions/generation");

beforeEach(() => {
  revalidatePath.mockReset();
  service.generateSkeleton.mockReset();
  service.generateAllSkeletons.mockReset();
  service.classifyProblem.mockReset();
});

describe("action generateSkeleton", () => {
  it("devrait revalider les pages du programme du thème régénéré", async () => {
    service.generateSkeleton.mockResolvedValue({ deckId: "deck-1", warnings: [], programId: "prog-1" });
    const result = await actions.generateSkeleton("theme-1");
    expect(result).toEqual({ ok: true, data: { deckId: "deck-1", warnings: [] } });
    expect(revalidatePath).toHaveBeenCalledWith("/programmes/prog-1", "layout");
  });
});

describe("action generateAllSkeletons", () => {
  it("devrait transmettre le mode « missing » par défaut", async () => {
    service.generateAllSkeletons.mockResolvedValue([]);
    await actions.generateAllSkeletons("prog-1");
    expect(service.generateAllSkeletons.mock.calls[0]![3]).toBe("missing");
  });

  it("devrait transmettre le mode « all » quand il est demandé", async () => {
    service.generateAllSkeletons.mockResolvedValue([]);
    await actions.generateAllSkeletons("prog-1", "all");
    expect(service.generateAllSkeletons.mock.calls[0]![3]).toBe("all");
  });

  it("devrait refuser un mode inconnu", async () => {
    const result = await actions.generateAllSkeletons("prog-1", "tout" as "all");
    expect(result.ok).toBe(false);
    expect(service.generateAllSkeletons).not.toHaveBeenCalled();
  });
});

describe("choix du moteur et de la facturation", () => {
  it("devrait résoudre le moteur de l'utilisateur connecté et transmettre fournisseur et facturation", async () => {
    getEngineForUser.mockResolvedValueOnce({ engine: "claude", provider: { name: "anthropic:x" }, billing: "user" });
    service.generateSkeleton.mockResolvedValue({ deckId: "d", warnings: [], programId: "p" });
    await actions.generateSkeleton("theme-1");
    expect(getEngineForUser).toHaveBeenCalledWith("user-1");
    expect(service.generateSkeleton.mock.calls[0]![2]).toMatchObject({ billing: "user", ai: { name: "anthropic:x" } });
  });

  it("devrait passer en mode gratuit quand le moteur gratuit est retenu", async () => {
    getEngineForUser.mockResolvedValueOnce({ engine: "free" });
    service.generateSkeleton.mockResolvedValue({ deckId: "d", warnings: [], programId: "p" });
    await actions.generateSkeleton("theme-1");
    expect(service.generateSkeleton.mock.calls[0]![2]).toMatchObject({ mode: "free" });
  });

  it("devrait renvoyer le message Paramètres quand le moteur choisi est indisponible (pas de bascule)", async () => {
    const { AiKeyRequiredError } = await import("@/server/errors");
    getEngineForUser.mockRejectedValueOnce(new AiKeyRequiredError());
    const result = await actions.generateSkeleton("theme-1");
    expect(result).toEqual({
      ok: false,
      error: "Ajoutez votre clé API Anthropic dans Paramètres pour lancer une génération.",
    });
    expect(service.generateSkeleton).not.toHaveBeenCalled();
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
