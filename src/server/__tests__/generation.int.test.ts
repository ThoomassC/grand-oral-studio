import { describe, expect, it } from "vitest";
import type { PromptPair } from "@/domain/contracts";
import type { Classification, DeckSpec } from "@/domain/schemas";
import { createMockProvider } from "@/server/ai/mock";
import type { AiProvider, ClassifyHints, DeckHints } from "@/server/ai/types";
import { db } from "@/server/db/client";
import { AiUnavailableError, NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import { AI_QUOTA, aiQuotaKey, consumeQuota, freeQuotaKey } from "@/server/rate-limit";
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
    generateStructured: mock.generateStructured,
  };
  return provider;
}

async function quotaUsed(userId: string, key: (userId: string) => string = aiQuotaKey): Promise<number> {
  const row = await db().usageWindow.findUnique({ where: { key: key(userId) } });
  return row?.count ?? 0;
}

const NOTES = "Vidéo : 60 % du trafic (Sandvine, Global Internet Phenomena, 2023)\nExemple : le mode basse définition des plateformes";

/** Programme de A à trois sujets, dont « Numérique » aux mots-clés reconnaissables et aux notes renseignées. */
async function setup() {
  const [a, b] = [await createUser("a"), await createUser("b")];
  const programId = await seedProgram(a.id);
  const [energie, numerique, ville] = await seedThemes(programId, [
    themeInput("Transition énergétique", ["énergie", "climat"]),
    themeInput("Numérique", ["internet", "données", "réseaux"], NOTES),
    themeInput("Ville de demain", ["urbanisme", "mobilité"]),
  ]);
  return { a, b, programId, energie: energie!, numerique: numerique!, ville: ville! };
}

const FREE = { mode: "free" as const, log: recordingLogger() };

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

  it("devrait lever ValidationError sans appeler l'IA pour un projet sans sujet", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const ai = providerWith({});
    const error = await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, deps(ai)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toBe("Ce projet n'a pas de sujet : la reconnaissance est inutile.");
    expect(ai.calls).toBe(0);
  });

  it("ne devrait jamais envoyer les notes des sujets à la reconnaissance", async () => {
    const { a, programId } = await setup();
    let sent: PromptPair | null = null;
    const mock = createMockProvider();
    const ai = providerWith({
      classify: async (prompt, hints) => {
        sent = prompt;
        return mock.classify(prompt, hints);
      },
    });
    await gen.classifyProblem(a.id, programId, { problem: PROBLEM, hintedThemeId: null }, deps(ai));
    expect(sent).not.toBeNull();
    expect(JSON.stringify(sent)).not.toContain("Sandvine");
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

describe("generateFinalDeck — avec un sujet", () => {
  it("devrait enregistrer un deck final portant la problématique", async () => {
    const { a, programId, numerique } = await setup();
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps());

    expect(result.reused).toBe(false);
    const deck = await decks.getDeck(a.id, result.deckId);
    expect(deck.kind).toBe("FINAL");
    expect(deck.themeId).toBe(numerique);
    expect(deck.themeName).toBe("Numérique");
    expect(deck.problem).toBe(PROBLEM);
    expect(deck.spec.slides.every((s) => s.layout === "title" || s.notes.length > 0)).toBe(true);
  });

  it("devrait transmettre au fournisseur la trame, le sujet et ses notes (bloc délimité)", async () => {
    const { a, programId, numerique } = await setup();
    let prompt: PromptPair | null = null;
    let hints: DeckHints | undefined;
    const mock = createMockProvider();
    const ai = providerWith({
      generateDeck: async (p, h) => {
        prompt = p;
        hints = h;
        return mock.generateDeck(p, h);
      },
    });
    await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    expect(hints?.subject).toMatchObject({ id: numerique, name: "Numérique", notes: NOTES });
    expect(hints?.compactPrompt).toBeTypeOf("function");
    expect(prompt!.user).toContain("<notes_sujet>");
    expect(prompt!.user).toContain("Sandvine, Global Internet Phenomena, 2023");
    expect(prompt!.user).toContain("contenu type : Constat.");
    expect(JSON.stringify(prompt)).not.toMatch(/squelette/i);
    // Version compacte pour un modèle local : mêmes consignes, notes retirées.
    expect(hints!.compactPrompt!(0).user).not.toContain("notes_sujet");
  });

  it("ne devrait pas proposer de version compacte quand le sujet n'a pas de notes", async () => {
    const { a, programId, ville } = await setup();
    let hints: DeckHints | undefined;
    const mock = createMockProvider();
    const ai = providerWith({
      generateDeck: async (p, h) => {
        hints = h;
        return mock.generateDeck(p, h);
      },
    });
    await gen.generateFinalDeck(a.id, { programId, themeId: ville, problem: PROBLEM }, deps(ai));
    expect(hints?.subject?.id).toBe(ville);
    expect(hints?.compactPrompt).toBeUndefined();
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

  it("devrait lever NotFoundError quand le sujet n'appartient pas au programme annoncé", async () => {
    const { a, numerique } = await setup();
    const otherProgram = await seedProgram(a.id, "Autre");
    const ai = providerWith({});
    const error = await gen.generateFinalDeck(a.id, { programId: otherProgram, themeId: numerique, problem: PROBLEM }, deps(ai)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).userMessage).toBe("Ce sujet est introuvable.");
    expect(ai.calls).toBe(0);
    expect(await quotaUsed(a.id)).toBe(0);
  });

  it("devrait lever NotFoundError sans appeler l'IA quand B vise un sujet de A", async () => {
    const { b, programId, numerique } = await setup();
    const ai = providerWith({});
    await expect(gen.generateFinalDeck(b.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(ai.calls).toBe(0);
    expect(await quotaUsed(b.id)).toBe(0);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait répondre « Ce sujet est introuvable. » quand le sujet est supprimé pendant la génération", async () => {
    const { a, programId, numerique } = await setup();
    const mock = createMockProvider();
    const ai = providerWith({
      generateDeck: async (prompt, hints) => {
        const deck = await mock.generateDeck(prompt, hints);
        await db().theme.delete({ where: { id: numerique } });
        return deck;
      },
    });
    const error = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).userMessage).toBe("Ce sujet est introuvable.");
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

  it("devrait lever RateLimitedError sans appeler l'IA quand le quota est épuisé", async () => {
    const { a, programId, numerique } = await setup();
    // Quota épuisé par le chemin réel (horodatage posé par la base), pas par un insert Prisma.
    await consumeQuota(aiQuotaKey(a.id), AI_QUOTA.limit, AI_QUOTA);
    const ai = providerWith({});
    await expect(gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai))).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    expect(ai.calls).toBe(0);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait écrire la problématique tirée sur la couverture et la diapo « Problématique », à la place d'une question inventée", async () => {
    const { a, programId, numerique } = await setup();
    const mock = createMockProvider();
    const ai = providerWith({
      generateDeck: async (prompt, hints) => {
        const deck = await mock.generateDeck(prompt, hints);
        deck.slides = deck.slides.map((s) =>
          s.sectionId === "problem" ? { ...s, title: "Faut-il interdire les écrans ?", bullets: ["Faut-il interdire les écrans ?"] } : s,
        );
        return deck;
      },
    });
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    const { spec } = await decks.getDeck(a.id, result.deckId);
    expect(spec.slides[0]!.subtitle).toBe(PROBLEM);
    const problemSlide = spec.slides.find((s) => s.sectionId === "problem")!;
    expect(problemSlide.bullets[0]).toBe(PROBLEM);
    expect(JSON.stringify(problemSlide)).not.toContain("interdire les écrans");
  });

  it("devrait suivre la trame du programme pour la structure du deck", async () => {
    const { a, programId, numerique } = await setup();
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps());
    const { spec } = await decks.getDeck(a.id, result.deckId);
    const sectionIds = [...new Set(spec.slides.slice(1).map((s) => s.sectionId))];
    expect(sectionIds).toEqual(makeTemplate().sections.map((s) => s.id));
    expect(result.warnings).toEqual([]);
  });

  it("devrait renvoyer et journaliser les écarts quand le deck produit ne suit pas la trame", async () => {
    const { a, programId, numerique } = await setup();
    const withoutCover: DeckSpec = { ...rewrittenDeck(), slides: rewrittenDeck().slides.slice(1) };
    const d = deps(providerWith({ generateDeck: async () => withoutCover }));
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, d);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(d.log.events.some((e) => e.level === "warn" && e.event === "deck.template_mismatch")).toBe(true);
  });
});

describe("generateFinalDeck — sans sujet", () => {
  it("devrait produire un deck sans sujet avec le moteur gratuit, quota gratuit consommé une fois", async () => {
    const { a, programId } = await setup();
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: null, problem: PROBLEM }, FREE);

    const deck = await decks.getDeck(a.id, result.deckId);
    expect(deck).toMatchObject({ kind: "FINAL", themeId: null, themeName: null, engine: "free", problem: PROBLEM });
    expect(deck.spec.slides[0]!.subtitle).toBe("Programme d'essai");
    expect(JSON.stringify(deck.spec)).not.toContain("Numérique");
    expect(await quotaUsed(a.id, freeQuotaKey)).toBe(1);
    expect(await quotaUsed(a.id)).toBe(0);
  });

  it("devrait produire un deck sans sujet avec un moteur IA (mock), sans bloc de sujet dans le prompt", async () => {
    const { a, programId } = await setup();
    let prompt: PromptPair | null = null;
    let hints: DeckHints | undefined;
    const mock = createMockProvider();
    const ai = providerWith({
      generateDeck: async (p, h) => {
        prompt = p;
        hints = h;
        return mock.generateDeck(p, h);
      },
    });
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: null, problem: PROBLEM }, deps(ai));

    expect(hints?.subject).toBeNull();
    expect(hints?.compactPrompt).toBeUndefined();
    expect(prompt!.user).toContain("Aucun sujet : appuie-toi sur la problématique et la trame.");
    expect(prompt!.user).not.toContain("<sujet>");
    expect(prompt!.user).not.toContain("Sandvine");
    const deck = await decks.getDeck(a.id, result.deckId);
    expect(deck.themeId).toBeNull();
    // Sans sujet, la problématique remplace le nom du projet en titre de couverture.
    expect(deck.spec.slides[0]!.title).not.toBe("Programme d'essai");
  });

  it("devrait n'appeler l'IA qu'une fois et créer un seul deck quand deux demandes identiques se chevauchent", async () => {
    const { a, programId } = await setup();
    const ai = providerWith({});
    const input = { programId, themeId: null, problem: PROBLEM };
    const [r1, r2] = await Promise.all([gen.generateFinalDeck(a.id, input, deps(ai)), gen.generateFinalDeck(a.id, input, deps(ai))]);
    expect(r1.deckId).toBe(r2.deckId);
    expect(ai.calls).toBe(1);
    expect(await db().deck.count({ where: { programId, kind: "FINAL" } })).toBe(1);
  });

  it("devrait réutiliser le deck sans sujet rejoué dans les 2 minutes", async () => {
    const { a, programId } = await setup();
    const first = await gen.generateFinalDeck(a.id, { programId, themeId: null, problem: PROBLEM }, FREE);
    const replay = await gen.generateFinalDeck(a.id, { programId, themeId: null, problem: PROBLEM }, FREE);
    expect(replay).toEqual({ deckId: first.deckId, warnings: [], reused: true });
    expect(await quotaUsed(a.id, freeQuotaKey)).toBe(1);
  });

  it("ne devrait pas confondre un deck sans sujet et un deck avec sujet pour la même problématique", async () => {
    const { a, programId, numerique } = await setup();
    const without = await gen.generateFinalDeck(a.id, { programId, themeId: null, problem: PROBLEM }, FREE);
    const withSubject = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, FREE);
    expect(withSubject.reused).toBe(false);
    expect(withSubject.deckId).not.toBe(without.deckId);
    expect(await db().deck.count({ where: { programId, kind: "FINAL" } })).toBe(2);
  });

  it("devrait lever NotFoundError sans rien consommer quand B vise le programme de A", async () => {
    const { b, programId } = await setup();
    const ai = providerWith({});
    const error = await gen.generateFinalDeck(b.id, { programId, themeId: null, problem: PROBLEM }, deps(ai)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).userMessage).toBe("Ce projet est introuvable.");
    expect(ai.calls).toBe(0);
    expect(await quotaUsed(b.id)).toBe(0);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait fonctionner pour un projet qui n'a aucun sujet", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: null, problem: PROBLEM }, deps());
    expect((await decks.getDeck(a.id, result.deckId)).themeId).toBeNull();
  });
});

/** Deck aux notes vides : ce qu'un modèle local rend parfois. */
function thinDeck(): DeckSpec {
  const deck = makeConformingDeck();
  deck.slides = deck.slides.map((s) => ({ ...s, notes: "[0:30–1:00]" }));
  return deck;
}

/** Deck rédigé pour PROBLEM : notes à dire, conclusion qui répond. */
function rewrittenDeck(): DeckSpec {
  const deck = makeConformingDeck();
  deck.slides = deck.slides.map((s, i) => ({
    ...s,
    bullets: [`Argument propre ${i} sur la sobriété des usages`, `Cas concret ${i} de streaming allégé`],
    notes:
      s.sectionId === "conclusion"
        ? "[19:00–20:00] Pour réduire la consommation de données sur internet, je retiens trois leviers : la sobriété des usages, des services allégés et la régulation."
        : `[1:${10 + i}–1:${30 + i}] Avec cet argument propre numéro ${i}, je montre au jury comment chaque usage pèse sur le volume de données échangées.`,
  }));
  return deck;
}

describe("generateFinalDeck — contrôle qualité et nouvelle tentative", () => {
  it("devrait refaire UNE tentative avec un retour explicite quand les notes sont à réécrire, garder la meilleure et compter deux unités de quota", async () => {
    const { a, programId, numerique } = await setup();
    const prompts: PromptPair[] = [];
    const ai = providerWith({
      generateDeck: async (prompt) => {
        prompts.push(prompt);
        return prompts.length === 1 ? thinDeck() : rewrittenDeck();
      },
    });

    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    expect(ai.calls).toBe(2);
    expect(await quotaUsed(a.id)).toBe(2);
    expect(prompts[1]!.user).toContain("Corrections exigées");
    expect(prompts[1]!.user).toMatch(/Notes d'orateur recopiées du contenu type de la trame ou trop courtes/);
    // Le retour s'ajoute au même prompt : notes du sujet toujours transmises.
    expect(prompts[1]!.user).toContain("<notes_sujet>");
    const { spec } = await decks.getDeck(a.id, result.deckId);
    expect(spec.slides[3]!.notes).toBe(rewrittenDeck().slides[3]!.notes);
    expect(result.warnings).toEqual([]);
  });

  it("ne devrait jamais faire plus de deux appels ni consommer plus de deux unités, et avertir quand le deck reste hors seuil", async () => {
    const { a, programId, numerique } = await setup();
    const worse = { ...thinDeck(), slides: thinDeck().slides.filter((s) => s.sectionId !== "part2") };
    let n = 0;
    const ai = providerWith({ generateDeck: async () => (++n === 1 ? thinDeck() : worse) });

    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    expect(ai.calls).toBe(2);
    expect(await quotaUsed(a.id)).toBe(2);
    const { spec } = await decks.getDeck(a.id, result.deckId);
    expect(spec.slides.filter((s) => s.sectionId === "part2")).toHaveLength(3);
    expect(result.warnings.some((w) => /trop courtes/.test(w))).toBe(true);
    expect(result.warnings.join(" ")).not.toMatch(/« part\d »|squelette/);
  });

  it("devrait demander à la nouvelle tentative les lignes à compléter, par leur titre", async () => {
    const { a, programId, numerique } = await setup();
    const prompts: PromptPair[] = [];
    const ai = providerWith({
      generateDeck: async (prompt) => {
        prompts.push(prompt);
        const deck = rewrittenDeck();
        return prompts.length === 1 ? { ...deck, slides: deck.slides.filter((s, i) => !(s.sectionId === "part2" && i > 5)) } : deck;
      },
    });

    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    expect(prompts[1]!.user).toContain("« Second axe » : 3 diapos (ta réponse en avait 1)");
    expect(result.warnings).toEqual([]);
  });

  it("devrait conserver la première tentative quand la seconde échoue, en restituant le quota d'un appel qui n'a rien calculé", async () => {
    const { a, programId, numerique } = await setup();
    let n = 0;
    const ai = providerWith({
      generateDeck: async () => {
        n += 1;
        if (n === 1) return thinDeck();
        throw new AiUnavailableError("connexion refusée", { refundable: true });
      },
    });

    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(ai));

    expect(ai.calls).toBe(2);
    expect(await quotaUsed(a.id)).toBe(1);
    expect(await db().deck.count({ where: { themeId: numerique, kind: "FINAL" } })).toBe(1);
    expect(result.warnings.some((w) => /nouvelle tentative/i.test(w))).toBe(true);
  });

  it("devrait signaler un chiffre affiché sans source", async () => {
    const { a, programId, numerique } = await setup();
    const deck = rewrittenDeck();
    deck.slides[3] = { ...deck.slides[3]!, bullets: ["70 % du trafic internet est de la vidéo"] };
    const result = await gen.generateFinalDeck(a.id, { programId, themeId: numerique, problem: PROBLEM }, deps(providerWith({ generateDeck: async () => deck })));
    expect(result.warnings.some((w) => /Chiffre sans source/.test(w) && w.includes("Un constat chiffré"))).toBe(true);
  });
});
