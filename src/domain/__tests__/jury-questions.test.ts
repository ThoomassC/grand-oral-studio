import { describe, expect, it } from "vitest";
import { fallbackJuryQuestions, JuryQuestionsSchema } from "@/domain/jury-questions";
import type { DeckSpec } from "@/domain/schemas";
import { makeConformingDeck, makeThemes } from "@/test/fixtures";

function withNotes(deck: DeckSpec, notes: Record<number, string>): DeckSpec {
  return { ...deck, slides: deck.slides.map((s, i) => (i in notes ? { ...s, notes: notes[i]! } : s)) };
}

const OBJECTION_DECK = withNotes(makeConformingDeck(), {
  3:
    "[3:00–5:00] La voiture représente 63 % des trajets domicile-travail.\n" +
    "Objection probable : les transports en commun ne desservent pas les zones rurales. — Réponse : le covoiturage organisé couvre ces zones.",
});

const subject = { ...makeThemes()[0]!, notes: "Les renouvelables fournissent 27 % de l'électricité.\nSource : bilan électrique 2023." };

describe("JuryQuestionsSchema", () => {
  const item = { question: "Pourquoi ce sujet ?", answer: "Parce qu'il me concerne." };

  it("devrait accepter de 1 à 12 questions", () => {
    expect(JuryQuestionsSchema.safeParse({ questions: [item] }).success).toBe(true);
    expect(JuryQuestionsSchema.safeParse({ questions: Array.from({ length: 12 }, () => item) }).success).toBe(true);
  });

  it.each([
    { label: "aucune question", input: { questions: [] } },
    { label: "13 questions", input: { questions: Array.from({ length: 13 }, () => item) } },
    { label: "réponse vide", input: { questions: [{ ...item, answer: "   " }] } },
    { label: "question de 1001 caractères", input: { questions: [{ ...item, question: "a".repeat(1001) }] } },
    { label: "réponse de 4001 caractères", input: { questions: [{ ...item, answer: "a".repeat(4001) }] } },
  ])("devrait refuser : $label", ({ input }) => {
    expect(JuryQuestionsSchema.safeParse(input).success).toBe(false);
  });

  it("devrait retirer les caractères de contrôle et les espaces de bord", () => {
    const parsed = JuryQuestionsSchema.parse({ questions: [{ question: "  Pourquoi\u0007 ?  ", answer: " Oui. " }] });
    expect(parsed.questions[0]).toEqual({ question: "Pourquoi ?", answer: "Oui." });
  });
});

describe("fallbackJuryQuestions", () => {
  it("devrait produire entre 8 et 10 questions valides selon le schéma", () => {
    const questions = fallbackJuryQuestions(OBJECTION_DECK, subject);
    expect(questions.length).toBeGreaterThanOrEqual(8);
    expect(questions.length).toBeLessThanOrEqual(10);
    expect(JuryQuestionsSchema.safeParse({ questions }).success).toBe(true);
  });

  it("devrait être déterministe", () => {
    expect(fallbackJuryQuestions(OBJECTION_DECK, subject)).toEqual(fallbackJuryQuestions(OBJECTION_DECK, subject));
  });

  it("ne devrait jamais poser deux fois la même question", () => {
    const questions = fallbackJuryQuestions(OBJECTION_DECK, subject).map((q) => q.question);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("devrait formuler chaque question comme une question", () => {
    expect(fallbackJuryQuestions(OBJECTION_DECK, subject).every((q) => q.question.endsWith("?"))).toBe(true);
  });

  it("devrait reprendre l'objection probable des notes avec sa réponse", () => {
    const questions = fallbackJuryQuestions(OBJECTION_DECK, subject);
    const objection = questions.find((q) => q.question.includes("les transports en commun ne desservent pas les zones rurales"));
    expect(objection?.answer).toContain("covoiturage organisé couvre ces zones");
  });

  it("devrait interroger sur un chiffre cité dans les notes", () => {
    const questions = fallbackJuryQuestions(OBJECTION_DECK, subject);
    const figure = questions.find((q) => q.question.includes("63 %"));
    expect(figure?.answer).toContain("63 % des trajets");
  });

  it("devrait demander pourquoi un axe plutôt qu'un autre en citant les titres d'axes", () => {
    const question = fallbackJuryQuestions(OBJECTION_DECK, subject).find((q) => q.question.includes("plutôt que"));
    expect(question?.question).toContain("« Un constat chiffré »");
    expect(question?.question).toContain("« Les leviers techniques »");
  });

  it("devrait demander un chiffre pour un mot-clé du sujet présent dans ses notes", () => {
    const withKeyword = { ...subject, keywords: ["renouvelable", "énergie"], notes: "Le renouvelable atteint 27 % de l'électricité." };
    const question = fallbackJuryQuestions(makeConformingDeck(), withKeyword).find((q) => q.question.includes("« renouvelable »"));
    expect(question?.question).toMatch(/^Quel chiffre retenez-vous pour « renouvelable » \?$/);
    expect(question?.answer).toContain("27 %");
  });

  it("ne devrait pas attribuer à un chiffre du diaporama une source du sujet", () => {
    const figure = fallbackJuryQuestions(OBJECTION_DECK, subject).find((q) => q.question.includes("63 %"));
    expect(figure?.answer).toContain("Source à préciser");
    expect(figure?.answer).not.toContain("bilan électrique");
  });

  it("devrait citer la source portée par la diapo du chiffre, sans double point", () => {
    const deck = withNotes(makeConformingDeck(), { 3: "La voiture représente 63 % des trajets.\nSource : enquête mobilité 2019." });
    const figure = fallbackJuryQuestions(deck, null).find((q) => q.question.includes("63 %"));
    expect(figure?.answer).toContain("Source : enquête mobilité 2019.");
    expect(figure?.answer).not.toContain("..");
  });

  it("devrait commencer la réponse à une objection par une majuscule", () => {
    const objection = fallbackJuryQuestions(OBJECTION_DECK, subject).find((q) => q.question.startsWith("On pourrait vous objecter"));
    expect(objection?.answer).toBe("Le covoiturage organisé couvre ces zones.");
  });

  it("devrait privilégier les mots-clés que les notes du sujet chiffrent", () => {
    const chiffred = { ...subject, keywords: ["énergie", "climat", "renouvelable"] };
    expect(fallbackJuryQuestions(makeConformingDeck(), chiffred).some((q) => q.question === "Quel chiffre retenez-vous pour « renouvelable » ?")).toBe(true);
  });

  it("ne devrait pas définir un mot-clé avec une description qui ne le mentionne pas", () => {
    const question = fallbackJuryQuestions(makeConformingDeck(), { ...subject, keywords: ["climat"], notes: "" }).find((q) => q.question.includes("« climat »"));
    expect(question?.answer).not.toContain(subject.description);
  });

  it("devrait reprendre le titre du diaporama dans la question de synthèse", () => {
    const questions = fallbackJuryQuestions(makeConformingDeck(), null);
    expect(questions.some((q) => q.question.includes("« Faut-il repenser nos mobilités »"))).toBe(true);
  });

  it("devrait encore produire au moins 8 questions pour un diaporama minimal sans sujet", () => {
    const minimal: DeckSpec = {
      title: "Sujet",
      subtitle: "",
      slides: [
        { layout: "title", sectionId: "cover", title: "Sujet", subtitle: "", bullets: [], notes: "" },
        { layout: "conclusion", sectionId: "conclusion", title: "Fin", subtitle: "", bullets: [], notes: "" },
      ],
    };
    const questions = fallbackJuryQuestions(minimal, null);
    expect(questions.length).toBeGreaterThanOrEqual(8);
    expect(JuryQuestionsSchema.safeParse({ questions }).success).toBe(true);
  });
});
