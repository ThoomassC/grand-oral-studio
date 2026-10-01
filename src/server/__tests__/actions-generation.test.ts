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
vi.mock("@/server/ai", () => ({ getAiProvider: () => ({ name: "mock" }) }));

const service = {
  generateSkeleton: vi.fn(),
  generateAllSkeletons: vi.fn(),
};
vi.mock("@/server/services/generation", () => ({
  generateSkeleton: (...args: unknown[]) => service.generateSkeleton(...args),
  generateAllSkeletons: (...args: unknown[]) => service.generateAllSkeletons(...args),
}));

const actions = await import("@/server/actions/generation");

beforeEach(() => {
  revalidatePath.mockReset();
  service.generateSkeleton.mockReset();
  service.generateAllSkeletons.mockReset();
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
