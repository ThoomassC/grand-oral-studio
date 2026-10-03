import { describe, expect, it } from "vitest";
import type { PromptPair } from "@/domain/contracts";
import type { Classification, DeckSpec } from "@/domain/schemas";
import { createMockProvider } from "@/server/ai/mock";
import type { AiProvider, ClassifyHints, DeckHints } from "@/server/ai/types";
import { db } from "@/server/db/client";
import { AiUnavailableError, NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import { AI_QUOTA, aiQuotaKey, consumeQuota } from "@/server/rate-limit";
import * as decks from "@/server/repo/decks";
import * as gen from "@/server/services/generation";
import { makeConformingDeck, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

const PROBLEM = "Comment réduire la consommation de données sur internet ?";

function deps(ai: AiProvider = createMockProvider()) {
  return { ai, log: recordingLogger() };
}

/** Fournisseur IA de test : délègue au mock, avec des surcharges ciblées. */
function providerWith(overrides: {
  generateDeck?: (prompt: PromptPair, hints?: DeckHints) => Promise<DeckSpec>;
  classify?: (prompt: PromptPair, hints?: ClassifyHints) => Promise<Classification>;
}): AiProvider & { calls: number } {
  const mock = createMockProvider();
  const provider = {
    name: "test",
    calls: 0,
    async generateDeck(prompt: PromptPair, hints?: DeckHints) {
      provider.calls += 1;
      return (overrides.generateDeck ?? mock.generateDeck)(prompt, hints);
    },
    async classify(prompt: PromptPair, hints?: ClassifyHints) {
      provider.calls += 1;
      return (overrides.classify ?? mock.classify)(prompt, hints);
    },
  };
  return provider;
}

async function quotaUsed(userId: string): Promise<number> {
  const row = await db().usageWindow.findUnique({ where: { key: aiQuotaKey(userId) } });
  return row?.count ?? 0;
}

/** Programme de A à trois thèmes, dont « Numérique » aux mots-clés reconnaissables. */
async function setup() {
  const [a, b] = [await createUser("a"), await createUser("b")];
  const programId = await seedProgram(a.id);
  const [energie, numerique, ville] = await seedThemes(programId, [
    themeInput("Transition énergétique", ["énergie", "climat"]),
    themeInput("Numérique", ["internet", "données", "réseaux"]),
    themeInput("Ville de demain", ["urbanisme", "mobilité"]),
  ]);
  return { a, b, programId, energie: energie!, numerique: numerique!, ville: ville! };
}

describe("generateSkeleton", () => {
  it("devrait enregistrer un squelette conforme au gabarit, sans écart", async () => {
    const { a, numerique } = await setup();
    const result = await gen.generateSkeleton(a.id, numerique, deps());

    expect(result.warnings).toEqual([]);
    const deck = await decks.getDeck(a.id, result.deckId);
    expect(deck.kind).toBe("SKELETON");
    expect(deck.themeId).toBe(numerique);
    expect(deck.spec.slides[0]!.layout).toBe("title");
    expect(deck.spec.slides).toHaveLength(9); // 1 couverture + 1 + 1 + 2 + 3 + 1 (makeTemplate)
  });

  it("devrait remplacer le squelette quand on régénère", async () => {
    const { a, numerique } = await setup();
    const first = await gen.generateSkeleton(a.id, numerique, deps());
    const second = await gen.generateSkeleton(a.id, numerique, deps());
    expect(second.deckId).toBe(first.deckId);
    expect(await db().deck.count({ where: { themeId: numerique, kind: "SKELETON" } })).toBe(1);
  });

  it("devrait n'appeler l'IA qu'une fois et garder un seul squelette quand deux générations se chevauchent", async () => {
    const { a, numerique } = await setup();
    const ai = providerWith({});
    const [r1, r2] = await Promise.all([gen.generateSkeleton(a.id, numerique, deps(ai)), gen.generateSkeleton(a.id, numerique, deps(ai))]);
    expect(r1.deckId).toBe(r2.deckId);
    expect(ai.calls).toBe(1);
    expect(await db().deck.count({ where: { themeId: numerique, kind: "SKELETON" } })).toBe(1);
  });

  it("devrait lever NotFoundError sans appeler l'IA ni consommer de quota quand B vise un thème de A", async () => {
    const { b, numerique } = await setup();
    const ai = providerWith({});
    await expect(gen.generateSkeleton(b.id, numerique, deps(ai))).rejects.toBeInstanceOf(NotFoundError);
    expect(ai.calls).toBe(0);
    expect(await quotaUsed(b.id)).toBe(0);
    expect(await db().deck.count({ where: { themeId: numerique } })).toBe(0);
  });

  it("devrait consommer une unité de quota par génération", async () => {
    const { a, numerique } = await setup();
    await gen.generateSkeleton(a.id, numerique, deps());
    expect(await quotaUsed(a.id)).toBe(1);
  });

  it("devrait lever RateLimitedError sans appeler l'IA quand le quota est épuisé", async () => {
    const { a, numerique } = await setup();
    // Quota épuisé par le chemin réel (horodatage posé par la base), pas par un insert Prisma.
    await consumeQuota(aiQuotaKey(a.id), AI_QUOTA.limit, AI_QUOTA);
    const ai = providerWith({});
    await expect(gen.generateSkeleton(a.id, numerique, deps(ai))).rejects.toBeInstanceOf(RateLimitedError);
    expect(ai.calls).toBe(0);
    expect(await db().deck.count({ where: { themeId: numerique } })).toBe(0);
  });

  it("ne devrait rien écrire quand le fournisseur IA est indisponible", async () => {
    const { a, numerique } = await setup();
    const ai = providerWith({ generateDeck: async () => Promise.reject(new AiUnavailableError("panne simulée")) });
    await expect(gen.generateSkeleton(a.id, numerique, deps(ai))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await db().deck.count({ where: { themeId: numerique } })).toBe(0);
  });

  it("ne devrait rien écrire quand le fournisseur IA renvoie un deck hors schéma", async () => {
    const { a, numerique } = await setup();
    const tooShort = { ...makeConformingDeck(), slides: makeConformingDeck().slides.slice(0, 1) };
    const ai = providerWith({ generateDeck: async () => tooShort });
    await expect(gen.generateSkeleton(a.id, numerique, deps(ai))).rejects.toThrow();
    expect(await db().deck.count({ where: { themeId: numerique } })).toBe(0);
  });

  it("devrait renvoyer et journaliser les écarts quand le deck produit ne suit pas le gabarit", async () => {
    const { a, numerique } = await setup();
    const withoutCover: DeckSpec = { ...makeConformingDeck(), slides: makeConformingDeck().slides.slice(1) };
    const d = deps(providerWith({ generateDeck: async () => withoutCover }));
    const result = await gen.generateSkeleton(a.id, numerique, d);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(d.log.events.some((e) => e.level === "warn" && e.event === "deck.template_mismatch")).toBe(true);
  });
});

describe("generateAllSkeletons", () => {
  it("devrait générer un squelette par thème", async () => {
    const { a, programId } = await setup();
    const results = await gen.generateAllSkeletons(a.id, programId, deps());
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(await db().deck.count({ where: { programId, kind: "SKELETON" } })).toBe(3);
  });

  it("devrait poursuivre les autres thèmes quand l'un échoue", async () => {
    const { a, programId, numerique } = await setup();
    const mock = createMockProvider();
    const ai = providerWith({
      generateDeck: async (prompt, hints) =>
        hints?.theme.id === numerique ? Promise.reject(new AiUnavailableError("panne simulée")) : mock.generateDeck(prompt, hints),
    });
    const results = await gen.generateAllSkeletons(a.id, programId, deps(ai));
    expect(results.map((r) => [r.themeName, r.ok])).toEqual([
      ["Transition énergétique", true],
      ["Numérique", false],
      ["Ville de demain", true],
    ]);
    expect(await db().deck.count({ where: { programId, kind: "SKELETON" } })).toBe(2);
  });

  it("devrait renvoyer une liste vide pour un programme sans thème", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    expect(await gen.generateAllSkeletons(a.id, programId, deps())).toEqual([]);
  });

  it("devrait lever NotFoundError quand B vise le programme de A", async () => {
    const { b, programId } = await setup();
    await expect(gen.generateAllSkeletons(b.id, programId, deps())).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });
});

describe("classifyProblem", () => {
  it("devrait classer en tête le thème dont les mots-clés correspondent à la problématique", async () => {
    const { a, programId, numerique } = await setup();
    const result = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, deps());
    expect(result.ranked[0]).toMatchObject({ themeId: numerique, themeName: "Numérique" });
    expect(result.reformulatedProblem.length).toBeGreaterThan(0);
  });

  it("devrait ne renvoyer que des thèmes du programme, au plus 3, triés par confiance", async () => {
    const { a, programId, energie, numerique, ville } = await setup();
    const result = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, deps());
    expect(result.ranked.length).toBeLessThanOrEqual(3);
    expect(result.ranked.every((r) => [energie, numerique, ville].includes(r.themeId))).toBe(true);
    const confidences = result.ranked.map((r) => r.confidence);
    expect(confidences).toEqual([...confidences].sort((x, y) => y - x));
  });

  it("devrait écarter les ids inventés ou étrangers renvoyés par l'IA", async () => {
    const { a, b, programId, ville } = await setup();
    const programB = await seedProgram(b.id);
    const [foreign] = await seedThemes(programB, [themeInput("Thème de B")]);
    const ai = providerWith({
      classify: async () => ({
        reformulatedProblem: "Reformulation",
        candidates: [
          { themeId: "invente", confidence: 0.99, rationale: "?" },
          { themeId: foreign!, confidence: 0.95, rationale: "?" },
          { themeId: ville, confidence: 0.4, rationale: "ok" },
        ],
      }),
    });
    const result = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, deps(ai));
    expect(result.ranked.map((r) => r.themeId)).toEqual([ville]);
  });

  it("devrait placer en tête le thème annoncé avec la problématique", async () => {
    const { a, programId, ville } = await setup();
    const result = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: ville }, deps());
    expect(result.ranked[0]?.themeId).toBe(ville);
  });

  it("ne devrait pas faire apparaître un thème annoncé appartenant à un autre utilisateur", async () => {
    const { a, b, programId } = await setup();
    const programB = await seedProgram(b.id);
    const [foreign] = await seedThemes(programB, [themeInput("Thème de B", ["internet"])]);
    const result = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: foreign! }, deps());
    expect(result.ranked.map((r) => r.themeId)).not.toContain(foreign);
  });

  it("devrait lever ValidationError sans appeler l'IA pour un programme sans thème", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const ai = providerWith({});
    await expect(gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, deps(ai))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(ai.calls).toBe(0);
  });

  it("devrait lever NotFoundError sans appeler l'IA quand B vise le programme de A", async () => {
    const { b, programId } = await setup();
    const ai = providerWith({});
    await expect(gen.classifyProblem(b.id, programId, { problem: PROBLEM, hintedThemeId: null }, deps(ai))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(ai.calls).toBe(0);
  });
});

describe("generateFinalDeck", () => {
  it("devrait enregistrer un deck final portant la problématique", async () => {
    const { a, programId, numerique } = await setup();
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps());

    expect(result.reused).toBe(false);
    const deck = await decks.getDeck(a.id, result.deckId);
    expect(deck.kind).toBe("FINAL");
    expect(deck.problem).toBe(PROBLEM);
    expect(deck.spec.slides.every((s) => s.layout === "title" || s.notes.length > 0)).toBe(true);
  });

  it("devrait s'appuyer sur le squelette existant du thème", async () => {
    const { a, programId, numerique } = await setup();
    const skeleton = makeConformingDeck();
    skeleton.slides[1] = { ...skeleton.slides[1]!, sectionId: "intro", bullets: ["Puce venue du squelette"] };
    await decks.upsertSkeleton(a.id, numerique, skeleton);
    let received: DeckSpec | null | undefined;
    const mock = createMockProvider();
    const ai = providerWith({
      generateDeck: async (prompt, hints) => {
        received = hints?.skeleton;
        return mock.generateDeck(prompt, hints);
      },
    });

    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    expect(received).toEqual(skeleton);
    const deck = await decks.getDeck(a.id, result.deckId);
    expect(deck.spec.slides.some((s) => s.bullets.includes("Puce venue du squelette"))).toBe(true);
  });

  it("devrait enregistrer le deck en complétant les notes trop courtes depuis le squelette, bornées et signalées", async () => {
    const { a, programId, numerique } = await setup();
    const skeleton = makeConformingDeck();
    // Notes du squelette à la borne : avec le minutage du deck, la concaténation dépasserait LIMITS.notes.
    const long = "Une phrase rédigée qui développe longuement le propos. ".repeat(60).slice(0, 3000);
    skeleton.slides = skeleton.slides.map((s) => ({ ...s, notes: long }));
    await decks.upsertSkeleton(a.id, numerique, skeleton);
    const ai = providerWith({
      generateDeck: async () => {
        const deck = makeConformingDeck();
        // L'IA omet une diapo de part1 et rend des notes réduites à un minutage.
        deck.slides = deck.slides.filter((_, i) => i !== 3).map((s) => ({ ...s, notes: "[0:30–2:00 environ, prendre son temps]" }));
        return deck;
      },
    });

    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    const { spec } = await decks.getDeck(a.id, result.deckId);
    expect(spec.slides.every((s) => s.notes.length <= 3000)).toBe(true);
    expect(spec.slides.find((s) => s.sectionId === "part1")!.notes).toBe("[0:30–2:00 environ, prendre son temps]");
    expect(result.warnings.some((w) => /reprises du squelette, à adapter/.test(w))).toBe(true);
    expect(result.warnings.some((w) => w.includes("part1") && /non complétée/.test(w))).toBe(true);
  });

  it("devrait fonctionner sans squelette", async () => {
    const { a, programId, ville } = await setup();
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: ville, problem: PROBLEM }, deps());
    expect((await decks.getDeck(a.id, result.deckId)).themeId).toBe(ville);
  });

  it("devrait réutiliser le deck récent sans rappeler l'IA quand la même demande est rejouée", async () => {
    const { a, programId, numerique } = await setup();
    const ai = providerWith({});
    const first = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));
    const replay = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    expect(replay).toEqual({ deckId: first.deckId, warnings: [], reused: true });
    expect(ai.calls).toBe(1);
    expect(await quotaUsed(a.id)).toBe(1);
    expect(await db().deck.count({ where: { themeId: numerique, kind: "FINAL" } })).toBe(1);
  });

  it("devrait créer un nouveau deck pour une autre problématique", async () => {
    const { a, programId, numerique } = await setup();
    await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps());
    const other = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: "Faut-il encadrer les réseaux sociaux ?" }, deps());
    expect(other.reused).toBe(false);
    expect(await db().deck.count({ where: { themeId: numerique, kind: "FINAL" } })).toBe(2);
  });

  it("devrait lever NotFoundError quand le thème n'appartient pas au programme annoncé", async () => {
    const { a, numerique } = await setup();
    const otherProgram = await seedProgram(a.id, "Autre");
    const ai = providerWith({});
    await expect(
      gen.generateFinalDeck(a.id, { programId: otherProgram, themeId: numerique, problem: PROBLEM }, deps(ai)),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ai.calls).toBe(0);
  });

  it("devrait lever NotFoundError sans appeler l'IA quand B vise un thème de A", async () => {
    const { b, programId, numerique } = await setup();
    const ai = providerWith({});
    await expect(gen.generateFinalDeck(b.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(ai.calls).toBe(0);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("ne devrait rien écrire quand le fournisseur IA est indisponible", async () => {
    const { a, programId, numerique } = await setup();
    const ai = providerWith({ generateDeck: async () => Promise.reject(new AiUnavailableError("panne simulée")) });
    await expect(gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai))).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait suivre le gabarit du programme pour la structure du deck", async () => {
    const { a, programId, numerique } = await setup();
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps());
    const { spec } = await decks.getDeck(a.id, result.deckId);
    const sectionIds = [...new Set(spec.slides.slice(1).map((s) => s.sectionId))];
    expect(sectionIds).toEqual(makeTemplate().sections.map((s) => s.id));
    expect(result.warnings).toEqual([]);
  });
});
