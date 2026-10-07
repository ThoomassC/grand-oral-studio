import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckHints } from "@/server/ai";
import type { AiProvider, CallOptions } from "@/server/ai/types";
import type { DeckSpec, PromptTemplate } from "@/domain/schemas";
import type { PromptPair } from "@/domain/contracts";
import { AiProviderRateLimitedError } from "@/server/errors";
import { makeConformingDeck, makeProgram, makeTemplate } from "@/test/fixtures";
import { recordingLogger } from "./helpers";

/**
 * Échéance de la génération du jour J : horloge, fournisseur, dépôt et quotas
 * injectés (aucune base, aucun réseau). On vérifie le budget passé à chaque
 * appel, la règle « pas de seconde tentative sous 120 s restantes », l'absence
 * d'échéance pour Ollama et le remboursement d'un 429 du fournisseur.
 */

const repo = {
  getFinalDeckContext: vi.fn(),
  findRecentFinalDeck: vi.fn(),
  createFinalDeck: vi.fn(),
  getGenerationContext: vi.fn(),
};
vi.mock("@/server/repo/decks", () => ({
  getFinalDeckContext: (...a: unknown[]) => repo.getFinalDeckContext(...a),
  findRecentFinalDeck: (...a: unknown[]) => repo.findRecentFinalDeck(...a),
  createFinalDeck: (...a: unknown[]) => repo.createFinalDeck(...a),
  getGenerationContext: (...a: unknown[]) => repo.getGenerationContext(...a),
}));

const quota = {
  consumeAiQuotaFor: vi.fn(async () => undefined),
  refundAiQuotaFor: vi.fn(async () => undefined),
  consumeFreeEngineQuota: vi.fn(async () => undefined),
};
vi.mock("@/server/rate-limit", () => ({
  consumeAiQuotaFor: (...a: unknown[]) => quota.consumeAiQuotaFor(...(a as [])),
  refundAiQuotaFor: (...a: unknown[]) => quota.refundAiQuotaFor(...(a as [])),
  consumeFreeEngineQuota: (...a: unknown[]) => quota.consumeFreeEngineQuota(...(a as [])),
}));

// Le contrôle qualité réel, forcé « hors seuil » quand le test le demande : la seconde tentative est alors envisagée.
const quality = { forceRetry: true };
vi.mock("@/domain/deck-quality", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/deck-quality")>();
  return {
    ...actual,
    assessFinalDeck: (deck: DeckSpec, ctx: { template: PromptTemplate; problem: string }) => {
      const real = actual.assessFinalDeck(deck, ctx);
      return quality.forceRetry ? { ...real, ok: false } : real;
    },
  };
});

const gen = await import("@/server/services/generation");

const PROBLEM = "Comment concilier mobilité et sobriété en ville ?";
const START = 1_800_000_000_000;

/** Horloge manuelle : chaque appel IA la fait avancer de la durée demandée. */
function fakeClock() {
  let now = START;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function provider(
  engine: AiProvider["engine"],
  onCall: (options: CallOptions | undefined, call: number) => DeckSpec | Promise<DeckSpec>,
): AiProvider & { calls: (CallOptions | undefined)[] } {
  const calls: (CallOptions | undefined)[] = [];
  return {
    name: `test:${engine}`,
    engine,
    calls,
    generateDeck: async (_prompt: PromptPair, _hints?: DeckHints, options?: CallOptions) => {
      calls.push(options);
      return onCall(options, calls.length);
    },
    classify: async () => {
      throw new Error("inutilisé");
    },
    generateStructured: async () => {
      throw new Error("inutilisé");
    },
  };
}

beforeEach(() => {
  quality.forceRetry = true;
  for (const fn of Object.values(repo)) fn.mockReset();
  for (const fn of Object.values(quota)) fn.mockClear();
  repo.getFinalDeckContext.mockResolvedValue({
    programId: "prog-1",
    ctx: makeProgram({ template: makeTemplate() }),
    brand: null,
    subject: null,
  });
  repo.findRecentFinalDeck.mockResolvedValue(null);
  repo.createFinalDeck.mockResolvedValue({ deckId: "deck-1" });
});

describe("readGenerationDeadline", () => {
  it("devrait valoir 280 s par défaut ou sur une valeur illisible", () => {
    expect(gen.readGenerationDeadline(undefined)).toBe(280_000);
    expect(gen.readGenerationDeadline("")).toBe(280_000);
    expect(gen.readGenerationDeadline("abc")).toBe(280_000);
    expect(gen.readGenerationDeadline("-5")).toBe(280_000);
  });

  it("devrait reprendre une valeur raisonnable et borner les extrêmes", () => {
    expect(gen.readGenerationDeadline("200000")).toBe(200_000);
    expect(gen.readGenerationDeadline("1000")).toBe(gen.GENERATION_DEADLINE_MIN_MS);
    expect(gen.readGenerationDeadline("99999999")).toBe(gen.GENERATION_DEADLINE_MAX_MS);
  });
});

describe("callBudgetMs", () => {
  it("devrait valoir min(240 s, restant − 10 s)", () => {
    expect(gen.callBudgetMs(280_000)).toBe(240_000);
    expect(gen.callBudgetMs(150_000)).toBe(140_000);
    expect(gen.callBudgetMs(130_000)).toBe(120_000);
  });
});

describe("generateFinalDeck — échéance", () => {
  it("devrait passer un budget de 240 s au premier appel et ne pas retenter s'il reste moins de 120 s", async () => {
    const clock = fakeClock();
    const ai = provider("mistral", () => {
      clock.advance(170_000); // reste 110 s sur 280
      return makeConformingDeck();
    });
    const log = recordingLogger();
    const result = await gen.generateFinalDeck(
      "user-1",
      { programId: "prog-1", themeId: null, problem: PROBLEM },
      { ai, log, billing: "user", timing: { now: clock.now, deadlineMs: 280_000 } },
    );
    expect(ai.calls).toEqual([{ budgetMs: 240_000 }]);
    // Une seule unité de quota : la seconde tentative n'a pas été engagée.
    expect(quota.consumeAiQuotaFor).toHaveBeenCalledTimes(1);
    expect(result.warnings.join(" ")).toMatch(/temps/i);
    expect(log.events.some((e) => e.event === "deck.final_retry_skipped")).toBe(true);
  });

  it("devrait retenter s'il reste au moins 120 s, avec un budget min(240 s, restant − 10 s)", async () => {
    const clock = fakeClock();
    const ai = provider("mistral", () => {
      clock.advance(100_000); // reste 180 s avant la seconde tentative
      return makeConformingDeck();
    });
    await gen.generateFinalDeck(
      "user-1",
      { programId: "prog-1", themeId: null, problem: PROBLEM },
      { ai, log: recordingLogger(), billing: "user", timing: { now: clock.now, deadlineMs: 280_000 } },
    );
    expect(ai.calls).toEqual([{ budgetMs: 240_000 }, { budgetMs: 170_000 }]);
    expect(quota.consumeAiQuotaFor).toHaveBeenCalledTimes(2);
  });

  it("ne devrait imposer aucune échéance à Ollama (pas de budget, seconde tentative toujours possible)", async () => {
    const clock = fakeClock();
    const ai = provider("ollama", () => {
      clock.advance(270_000);
      return makeConformingDeck();
    });
    await gen.generateFinalDeck(
      "user-1",
      { programId: "prog-1", themeId: null, problem: PROBLEM },
      { ai, log: recordingLogger(), billing: "local", timing: { now: clock.now, deadlineMs: 280_000 } },
    );
    expect(ai.calls).toEqual([undefined, undefined]);
  });

  it("devrait restituer l'unité de quota quand le fournisseur répond 429, et remonter l'erreur", async () => {
    const ai = provider("mistral", () => {
      throw new AiProviderRateLimitedError("mistral", 30);
    });
    const error = await gen
      .generateFinalDeck(
        "user-1",
        { programId: "prog-1", themeId: null, problem: PROBLEM },
        { ai, log: recordingLogger(), billing: "user", timing: { now: fakeClock().now } },
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderRateLimitedError);
    expect(quota.refundAiQuotaFor).toHaveBeenCalledWith("user", "user-1", 1);
    expect(repo.createFinalDeck).not.toHaveBeenCalled();
  });
});

describe("generateFinalDeck — entraînement, départ du chrono et auteur", () => {
  it("devrait enregistrer createdById, practice et prepStartedAt, et chercher un deck récent du même type", async () => {
    quality.forceRetry = false;
    const ai = provider("mistral", () => makeConformingDeck());
    const prepStartedAt = new Date(START - 20 * 60_000);
    const result = await gen.generateFinalDeck(
      "user-1",
      { programId: "prog-1", themeId: null, problem: PROBLEM, practice: true, prepStartedAt },
      { ai, log: recordingLogger(), billing: "user", timing: { now: fakeClock().now } },
    );
    expect(result).toEqual({ deckId: "deck-1", warnings: expect.any(Array), reused: false, engine: "mistral" });
    expect(repo.findRecentFinalDeck.mock.calls[0]![1]).toMatchObject({ practice: true, engine: "mistral" });
    expect(repo.createFinalDeck.mock.calls[0]![1]).toMatchObject({
      practice: true,
      prepStartedAt,
      createdById: "user-1",
      engine: "mistral",
    });
  });

  it("devrait renvoyer le moteur avec un deck récent réutilisé", async () => {
    repo.findRecentFinalDeck.mockResolvedValue({ deckId: "deck-old" });
    const result = await gen.generateFinalDeck(
      "user-1",
      { programId: "prog-1", themeId: null, problem: PROBLEM },
      { mode: "free", log: recordingLogger() },
    );
    expect(result).toEqual({ deckId: "deck-old", warnings: [], reused: true, engine: "free" });
    expect(repo.findRecentFinalDeck.mock.calls[0]![1]).toMatchObject({ practice: false });
  });

  it("ne devrait pas fusionner une demande d'entraînement avec la même demande du jour J (singleFlight)", async () => {
    quality.forceRetry = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ai = provider("mistral", async () => {
      await gate;
      return makeConformingDeck();
    });
    repo.createFinalDeck.mockResolvedValueOnce({ deckId: "deck-exam" }).mockResolvedValueOnce({ deckId: "deck-practice" });
    const deps = { ai, log: recordingLogger(), billing: "user" as const, timing: { now: fakeClock().now } };
    const exam = gen.generateFinalDeck("user-1", { programId: "prog-1", themeId: null, problem: PROBLEM }, deps);
    const practice = gen.generateFinalDeck("user-1", { programId: "prog-1", themeId: null, problem: PROBLEM, practice: true }, deps);
    await vi.waitFor(() => expect(ai.calls).toHaveLength(2));
    release();
    const ids = [(await exam).deckId, (await practice).deckId].sort();
    expect(ids).toEqual(["deck-exam", "deck-practice"]);
  });
});
