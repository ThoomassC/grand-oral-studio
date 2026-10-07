import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Slide } from "@/domain/schemas";
import { AiProviderRateLimitedError, AiRefusalError, ConflictError, RateLimitedError } from "@/server/errors";
import { makeConformingDeck, makeTemplate } from "@/test/fixtures";

/**
 * Actions du diaporama : régénération d'une diapo par IA (rédacteur de
 * l'utilisateur, quota IA, contrôle de version, aucune bascule Sans IA) et
 * transport des éditions structurelles, de la duplication et de l'annulation.
 * Le service deck-editing est réel ; dépôt, IA, quota et Next sont isolés.
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("@/server/session", () => ({ requireUser: async () => ({ id: "u1", email: "lea@lycee.fr", name: "Léa" }) }));

const consumeAiQuotaFor = vi.fn();
const refundAiQuotaFor = vi.fn();
vi.mock("@/server/rate-limit", () => ({
  consumeAiQuotaFor: (...a: unknown[]) => consumeAiQuotaFor(...a),
  refundAiQuotaFor: (...a: unknown[]) => refundAiQuotaFor(...a),
}));

const generateStructured = vi.fn();
const getEngineForUser = vi.fn();
vi.mock("@/server/ai", () => ({ getEngineForUser: (...a: unknown[]) => getEngineForUser(...a) }));

const repo = {
  getSlideEditContext: vi.fn(),
  updateDeckSlide: vi.fn(),
  insertSlide: vi.fn(),
  removeSlide: vi.fn(),
  moveSlide: vi.fn(),
  duplicateDeck: vi.fn(),
  deleteDeck: vi.fn(),
  restoreDeck: vi.fn(),
};
vi.mock("@/server/repo/decks", () => ({
  DECK_CHANGED_MESSAGE: "Ce diaporama a changé entre-temps (autre onglet). Rechargez la page pour voir la dernière version.",
  ...Object.fromEntries(Object.entries(repo).map(([name, fn]) => [name, (...a: unknown[]) => fn(...a)])),
}));

const actions = await import("@/server/actions/decks");

const VERSION = "2026-10-07T08:00:00.000Z";
const SPEC = makeConformingDeck();
const AI_SLIDE: Slide = {
  layout: "two-columns",
  sectionId: "autre",
  title: "Un constat réécrit",
  subtitle: "",
  bullets: ["Une idée nouvelle"],
  notes: "[2:00–2:40] Je reprends ce constat avec un exemple que le jury connaît.",
};

beforeEach(() => {
  for (const fn of [revalidatePath, consumeAiQuotaFor, refundAiQuotaFor, generateStructured, getEngineForUser, ...Object.values(repo)]) {
    fn.mockReset();
  }
  getEngineForUser.mockResolvedValue({
    engine: "mistral",
    provider: { name: "mistral", engine: "mistral", generateStructured },
    billing: "user",
    keySource: "user",
    model: "mistral-large",
  });
  repo.getSlideEditContext.mockResolvedValue({
    programId: "p1",
    spec: SPEC,
    updatedAt: VERSION,
    problem: "Comment concilier mobilité et sobriété ?",
    template: makeTemplate(),
    subject: null,
  });
  generateStructured.mockResolvedValue(AI_SLIDE);
  repo.updateDeckSlide.mockImplementation(async (_u: string, _d: string, index: number, slide: Slide) => ({
    programId: "p1",
    spec: { ...SPEC, slides: SPEC.slides.map((s, i) => (i === index ? slide : s)) },
    updatedAt: "2026-10-07T08:01:00.000Z",
  }));
});

describe("regenerateSlide", () => {
  it("devrait réécrire la diapo par l'IA du rédacteur, en gardant sa place dans la trame", async () => {
    const result = await actions.regenerateSlide("d1", 3, VERSION);

    expect(result.ok).toBe(true);
    const request = generateStructured.mock.calls[0]![0] as { task: string; hints: unknown; prompt: { user: string } };
    expect(request.task).toBe("slide");
    expect(request.hints).toEqual({ current: SPEC.slides[3] });
    expect(request.prompt.user).toContain("Comment concilier mobilité et sobriété ?");
    expect(consumeAiQuotaFor).toHaveBeenCalledWith("user", "u1", 1);
    // Écriture sous verrou avec la version de départ ; mise en page et section conservées.
    expect(repo.updateDeckSlide).toHaveBeenCalledWith(
      "u1",
      "d1",
      3,
      { ...AI_SLIDE, layout: "content", sectionId: "part1" },
      VERSION,
    );
    expect(result).toMatchObject({ ok: true, data: { updatedAt: "2026-10-07T08:01:00.000Z" } });
    expect(revalidatePath).toHaveBeenCalledWith("/projets/p1", "layout");
  });

  it("Sans IA : devrait refuser avec un message clair, sans quota ni lecture", async () => {
    getEngineForUser.mockResolvedValue({ engine: "free" });
    const result = await actions.regenerateSlide("d1", 3, VERSION);
    expect(result).toEqual({
      ok: false,
      code: "ENGINE_UNAVAILABLE",
      error: expect.stringContaining("Disponible avec une rédaction IA"),
    });
    expect(consumeAiQuotaFor).not.toHaveBeenCalled();
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("devrait refuser une version périmée AVANT d'appeler l'IA ou de consommer le quota", async () => {
    const result = await actions.regenerateSlide("d1", 3, "2026-10-07T07:00:00.000Z");
    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(consumeAiQuotaFor).not.toHaveBeenCalled();
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("devrait signaler un conflit survenu pendant la génération (écriture sous verrou)", async () => {
    repo.updateDeckSlide.mockRejectedValue(new ConflictError("Ce diaporama a changé entre-temps."));
    expect(await actions.regenerateSlide("d1", 3, VERSION)).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("devrait refuser une diapo inexistante sans quota", async () => {
    const result = await actions.regenerateSlide("d1", 42, VERSION);
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(consumeAiQuotaFor).not.toHaveBeenCalled();
  });

  it("devrait s'arrêter au quota IA atteint", async () => {
    consumeAiQuotaFor.mockRejectedValue(new RateLimitedError(600));
    expect(await actions.regenerateSlide("d1", 3, VERSION)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(generateStructured).not.toHaveBeenCalled();
    expect(repo.updateDeckSlide).not.toHaveBeenCalled();
  });

  it("devrait restituer le quota quand le fournisseur refuse sans calculer, et ne rien écrire", async () => {
    generateStructured.mockRejectedValue(new AiProviderRateLimitedError("mistral", 30));
    const result = await actions.regenerateSlide("d1", 3, VERSION);
    expect(result).toMatchObject({ ok: false, code: "AI_RATE_LIMITED" });
    expect(refundAiQuotaFor).toHaveBeenCalledWith("user", "u1", 1);
    expect(repo.updateDeckSlide).not.toHaveBeenCalled();
  });

  it("ne devrait pas restituer le quota d'une erreur IA après calcul", async () => {
    generateStructured.mockRejectedValue(new AiRefusalError(null));
    expect(await actions.regenerateSlide("d1", 3, VERSION)).toMatchObject({ ok: false, code: "AI_REFUSAL" });
    expect(refundAiQuotaFor).not.toHaveBeenCalled();
  });

  it("devrait réappliquer la problématique à la couverture réécrite (sous-titre conservé)", async () => {
    generateStructured.mockResolvedValue({ ...AI_SLIDE, layout: "content", title: "Une couverture réécrite", subtitle: "Un sous-titre inventé" });
    expect((await actions.regenerateSlide("d1", 0, VERSION)).ok).toBe(true);
    const written = repo.updateDeckSlide.mock.calls[0]![3] as Slide;
    expect(written).toMatchObject({ layout: "title", sectionId: "cover", subtitle: "Comment concilier mobilité et sobriété ?" });
  });

  it("devrait réécrire la problématique sur la diapo de la ligne « problématique »", async () => {
    generateStructured.mockResolvedValue({ ...AI_SLIDE, title: "Une autre question ?", bullets: ["Une question inventée ?"] });
    expect((await actions.regenerateSlide("d1", 2, VERSION)).ok).toBe(true);
    const written = repo.updateDeckSlide.mock.calls[0]![3] as Slide;
    expect(written.bullets[0]).toBe("Comment concilier mobilité et sobriété ?");
    expect(written.bullets).not.toContain("Une question inventée ?");
  });

  it("ne devrait rien imposer sans problématique (ancien squelette)", async () => {
    repo.getSlideEditContext.mockResolvedValue({ programId: "p1", spec: SPEC, updatedAt: VERSION, problem: "", template: makeTemplate(), subject: null });
    generateStructured.mockResolvedValue({ ...AI_SLIDE, subtitle: "Libre" });
    expect((await actions.regenerateSlide("d1", 0, VERSION)).ok).toBe(true);
    expect((repo.updateDeckSlide.mock.calls[0]![3] as Slide).subtitle).toBe("Libre");
  });

  it("devrait remonter l'erreur d'origine du fournisseur même si le remboursement échoue", async () => {
    generateStructured.mockRejectedValue(new AiProviderRateLimitedError("mistral", 30));
    refundAiQuotaFor.mockRejectedValue(new Error("base indisponible"));
    expect(await actions.regenerateSlide("d1", 3, VERSION)).toMatchObject({ ok: false, code: "AI_RATE_LIMITED", retryAfterSeconds: 30 });
  });

  it("devrait fusionner deux demandes simultanées sur la même diapo et la même version (un seul appel IA)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    generateStructured.mockImplementation(async () => {
      await gate;
      return AI_SLIDE;
    });
    const first = actions.regenerateSlide("d1", 3, VERSION);
    const second = actions.regenerateSlide("d1", 3, VERSION);
    await vi.waitFor(() => expect(generateStructured).toHaveBeenCalledTimes(1));
    release();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(consumeAiQuotaFor).toHaveBeenCalledTimes(1);
    expect(repo.updateDeckSlide).toHaveBeenCalledTimes(1);
  });

  it("devrait refuser un index ou une version illisibles avant tout appel", async () => {
    expect((await actions.regenerateSlide("d1", -1, VERSION)).ok).toBe(false);
    expect((await actions.regenerateSlide("d1", 1, "hier")).ok).toBe(false);
    expect(getEngineForUser).not.toHaveBeenCalled();
  });
});

describe("éditions structurelles", () => {
  const edited = { programId: "p1", spec: SPEC, updatedAt: "2026-10-07T08:02:00.000Z" };

  it("devrait insérer une diapo vierge après la diapo visée", async () => {
    repo.insertSlide.mockResolvedValue(edited);
    expect(await actions.insertSlideAfter("d1", 3, VERSION)).toEqual({ ok: true, data: { spec: SPEC, updatedAt: edited.updatedAt } });
    expect(repo.insertSlide).toHaveBeenCalledWith("u1", "d1", 4, null, VERSION);
    expect(revalidatePath).toHaveBeenCalledWith("/projets/p1", "layout");
  });

  it("devrait supprimer et déplacer d'un cran", async () => {
    repo.removeSlide.mockResolvedValue(edited);
    repo.moveSlide.mockResolvedValue(edited);
    expect((await actions.removeSlide("d1", 3, VERSION)).ok).toBe(true);
    expect(repo.removeSlide).toHaveBeenCalledWith("u1", "d1", 3, VERSION);
    expect((await actions.moveSlide("d1", 3, "up", VERSION)).ok).toBe(true);
    expect(repo.moveSlide).toHaveBeenCalledWith("u1", "d1", 3, 2, VERSION);
    expect((await actions.moveSlide("d1", 3, "down", VERSION)).ok).toBe(true);
    expect(repo.moveSlide).toHaveBeenLastCalledWith("u1", "d1", 3, 4, VERSION);
  });

  it("devrait refuser une direction inconnue", async () => {
    expect((await actions.moveSlide("d1", 3, "left" as never, VERSION)).ok).toBe(false);
    expect(repo.moveSlide).not.toHaveBeenCalled();
  });

  it("devrait renvoyer le code d'un conflit (recharger)", async () => {
    repo.removeSlide.mockRejectedValue(new ConflictError("Ce diaporama a changé entre-temps."));
    expect(await actions.removeSlide("d1", 3, VERSION)).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("devrait dupliquer le diaporama et renvoyer la copie", async () => {
    repo.duplicateDeck.mockResolvedValue({ programId: "p1", deckId: "d2" });
    expect(await actions.duplicateDeck("d1")).toEqual({ ok: true, data: { deckId: "d2" } });
    expect(repo.duplicateDeck).toHaveBeenCalledWith("u1", "d1");
  });
});

describe("suppression et annulation", () => {
  it("devrait renvoyer l'échéance d'annulation d'une suppression", async () => {
    repo.deleteDeck.mockResolvedValue({ programId: "p1", themeId: null, undoUntil: "2026-10-07T08:00:30.000Z" });
    expect(await actions.deleteDeck("d1")).toEqual({ ok: true, data: { undoUntil: "2026-10-07T08:00:30.000Z" } });
  });

  it("devrait renvoyer null pour un ancien squelette (suppression définitive)", async () => {
    repo.deleteDeck.mockResolvedValue({ programId: "p1", themeId: "t1" });
    expect(await actions.deleteDeck("d1")).toEqual({ ok: true, data: { undoUntil: null } });
  });

  it("devrait restaurer un diaporama supprimé", async () => {
    repo.restoreDeck.mockResolvedValue({ programId: "p1", themeId: null });
    expect(await actions.restoreDeck("d1")).toEqual({ ok: true, data: null });
    expect(repo.restoreDeck).toHaveBeenCalledWith("u1", "d1");
    expect(revalidatePath).toHaveBeenCalledWith("/projets/p1", "layout");
  });
});
