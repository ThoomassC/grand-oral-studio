import { describe, expect, it } from "vitest";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { DeckSpecSchema } from "@/domain/schemas";
import { createMockProvider } from "@/server/ai/mock";
import { JuryQuestionsSchema } from "@/domain/jury-questions";
import { makeConformingDeck, makeTemplate, makeThemes } from "@/test/fixtures";

const PROBLEM = "Comment concilier mobilité urbaine et sobriété énergétique ?";

describe("fournisseur mock", () => {
  it("devrait produire un deck valide et conforme même avec des contenus types très longs", async () => {
    const template = makeTemplate({
      sections: makeTemplate().sections.map((s) => ({ ...s, guidance: "Consigne détaillée ".repeat(30).slice(0, 600) })),
    });
    const deck = await createMockProvider().generateDeck(
      { system: "", user: "" },
      { template, subject: makeThemes()[0]!, programName: "P", problem: "Une problématique ".repeat(80).slice(0, 1500) },
    );
    expect(DeckSpecSchema.safeParse(deck).success).toBe(true);
    expect(checkDeckAgainstTemplate(deck, template)).toEqual([]);
  });

  it("devrait produire, sans sujet, un deck conforme à la trame qui s'appuie sur la problématique", async () => {
    const template = makeTemplate();
    const deck = await createMockProvider().generateDeck({ system: "", user: "" }, { template, subject: null, programName: "Projet P", problem: PROBLEM });
    expect(DeckSpecSchema.safeParse(deck).success).toBe(true);
    expect(checkDeckAgainstTemplate(deck, template)).toEqual([]);
    expect(deck.slides[0]!.title).toBe(PROBLEM);
    expect(deck.slides[0]!.subtitle).toBe("Projet P");
    const bullets = deck.slides.flatMap((s) => s.bullets).join(" ");
    expect(bullets).toMatch(/mobilite|sobriete/);
    for (const theme of makeThemes()) expect(JSON.stringify(deck)).not.toContain(theme.name);
  });

  it("devrait reprendre le nom et les mots-clés du sujet quand il y en a un", async () => {
    const subject = makeThemes()[2]!;
    const deck = await createMockProvider().generateDeck({ system: "", user: "" }, { template: makeTemplate(), subject, programName: "P", problem: PROBLEM });
    expect(deck.slides[0]!.subtitle).toBe(subject.name);
    expect(deck.slides.flatMap((s) => s.bullets).join(" ")).toContain(subject.keywords[0]!);
  });

  it("ne devrait plus proposer de brouillons d'import (imports sans IA)", () => {
    const provider = createMockProvider();
    expect(Object.keys(provider).sort()).toEqual(["classify", "engine", "generateDeck", "generateStructured", "name"]);
  });
});

describe("fournisseur mock — tâches structurées (1.2)", () => {
  it("devrait produire des questions du jury déterministes et valides à partir du diaporama", async () => {
    const spec = makeConformingDeck();
    const hints = { spec, subject: makeThemes()[0]! };
    const a = await createMockProvider().generateStructured({ task: "juryQuestions", prompt: { system: "", user: "" }, hints });
    const b = await createMockProvider().generateStructured({ task: "juryQuestions", prompt: { system: "", user: "" }, hints });
    expect(a).toEqual(b);
    expect(JuryQuestionsSchema.safeParse(a).success).toBe(true);
  });

  it("devrait réécrire une diapo de façon déterministe et idempotente", async () => {
    const current = makeConformingDeck().slides[1]!;
    const once = await createMockProvider().generateStructured({ task: "slide", prompt: { system: "", user: "" }, hints: { current } });
    expect(once).toEqual({ ...current, title: `${current.title} (révisé)` });
    const twice = await createMockProvider().generateStructured({ task: "slide", prompt: { system: "", user: "" }, hints: { current: once } });
    expect(twice).toEqual(once);
  });

  it("devrait exiger les indications", async () => {
    await expect(createMockProvider().generateStructured({ task: "slide", prompt: { system: "", user: "" } })).rejects.toMatchObject({ detail: expect.stringMatching(/hints/) });
  });
});
