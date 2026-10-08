import { describe, expect, it } from "vitest";
import {
  checkDeckAgainstTemplate,
  DeckEditError,
  duplicateDeckSpec,
  insertSlide,
  isThinNotes,
  MAX_DECK_SLIDES,
  MIN_DECK_SLIDES,
  moveSlide,
  removeSlide,
  replaceSlide,
} from "@/domain/deck";
import type { DeckSpec, Slide } from "@/domain/schemas";
import { makeConformingDeck, makeTemplate } from "@/test/fixtures";

const newSlide: Slide = {
  layout: "content",
  sectionId: "part1",
  title: "Diapo remplacée",
  subtitle: "",
  bullets: ["Nouvelle puce"],
  notes: "Nouvelle note.",
};

describe("checkDeckAgainstTemplate", () => {
  it("devrait renvoyer une liste vide quand le deck est conforme à la trame", () => {
    expect(checkDeckAgainstTemplate(makeConformingDeck(), makeTemplate())).toEqual([]);
  });

  it("devrait signaler l'absence de couverture quand la première diapo n'a pas le layout title", () => {
    const deck = makeConformingDeck();
    const withoutCover: DeckSpec = { ...deck, slides: deck.slides.slice(1) };
    const issues = checkDeckAgainstTemplate(withoutCover, makeTemplate());
    expect(issues.some((issue) => /couverture/i.test(issue))).toBe(true);
  });

  it("devrait signaler la couverture quand la diapo title n'est pas en tête", () => {
    const deck = makeConformingDeck();
    const [cover, ...rest] = deck.slides;
    const issues = checkDeckAgainstTemplate({ ...deck, slides: [...rest, cover] }, makeTemplate());
    expect(issues.some((issue) => /couverture/i.test(issue))).toBe(true);
  });

  it("devrait signaler une section de la trame absente du deck en citant son titre", () => {
    const deck = makeConformingDeck();
    const withoutConclusion: DeckSpec = { ...deck, slides: deck.slides.filter((s) => s.sectionId !== "conclusion") };
    const issues = checkDeckAgainstTemplate(withoutConclusion, makeTemplate());
    expect(issues.some((issue) => issue.includes("« Conclusion »"))).toBe(true);
  });

  it("devrait signaler une section dont le nombre de diapos diffère de la trame en citant son titre", () => {
    const deck = makeConformingDeck();
    const firstPart2 = deck.slides.findIndex((s) => s.sectionId === "part2");
    const shortPart2: DeckSpec = { ...deck, slides: deck.slides.filter((_, i) => i !== firstPart2) };
    const issues = checkDeckAgainstTemplate(shortPart2, makeTemplate());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("« Second axe »");
    expect(issues[0]).not.toContain("part2");
  });

  it("devrait signaler une section qui a trop de diapos", () => {
    const deck = makeConformingDeck();
    const extra: Slide = { ...newSlide, sectionId: "intro" };
    const issues = checkDeckAgainstTemplate({ ...deck, slides: [...deck.slides.slice(0, 2), extra, ...deck.slides.slice(2)] }, makeTemplate());
    expect(issues.some((issue) => issue.includes("« Introduction »"))).toBe(true);
  });
});

describe("replaceSlide", () => {
  it("devrait remplacer la diapo à l'index donné", () => {
    const result = replaceSlide(makeConformingDeck(), 3, newSlide);
    expect(result.slides[3]).toEqual(newSlide);
    expect(result.slides).toHaveLength(makeConformingDeck().slides.length);
  });

  it("devrait laisser les autres diapos et les métadonnées du deck intactes", () => {
    const result = replaceSlide(makeConformingDeck(), 3, newSlide);
    const expected = makeConformingDeck();
    expect(result.title).toBe(expected.title);
    expect(result.slides.filter((_, i) => i !== 3)).toEqual(expected.slides.filter((_, i) => i !== 3));
  });

  it("ne devrait pas muter le deck reçu", () => {
    const deck = makeConformingDeck();
    replaceSlide(deck, 3, newSlide);
    expect(deck).toEqual(makeConformingDeck());
  });

  it.each([
    { index: -1, label: "négatif" },
    { index: 9, label: "égal à la longueur" },
    { index: 42, label: "au-delà de la fin" },
  ])("devrait lever une RangeError quand l'index est $label", ({ index }) => {
    expect(() => replaceSlide(makeConformingDeck(), index, newSlide)).toThrow(RangeError);
  });
});

describe("isThinNotes", () => {
  it.each([
    { notes: "", thin: true },
    { notes: "[0:30–2:00]", thin: true },
    { notes: "[0:30–2:00] Présentez le contexte.", thin: true },
    { notes: "[0:30–2:00] Je commence par une situation que chacun connaît, puis j'annonce la question.", thin: false },
  ])("devrait juger « $notes » trop courte : $thin", ({ notes, thin }) => {
    expect(isThinNotes(notes)).toBe(thin);
  });
});

describe("checkDeckAgainstTemplate — vocabulaire", () => {
  it("devrait parler de la trame, plus du gabarit", () => {
    const deck = makeConformingDeck();
    const shuffled: DeckSpec = {
      ...deck,
      slides: [deck.slides[0]!, ...deck.slides.slice(1).reverse(), { ...newSlide, sectionId: "inconnue" }],
    };
    const issues = checkDeckAgainstTemplate(shuffled, makeTemplate()).join(" ");
    expect(issues).toMatch(/trame/);
    expect(issues).not.toMatch(/gabarit/);
  });
});

// ---------------------------------------------------------------------------
// Édition structurelle (v1.2)
// ---------------------------------------------------------------------------

function deckOf(count: number, withCover = true): DeckSpec {
  return {
    title: "Deck d'essai",
    subtitle: "",
    slides: Array.from({ length: count }, (_, i) => ({
      ...newSlide,
      layout: withCover && i === 0 ? ("title" as const) : ("content" as const),
      sectionId: withCover && i === 0 ? "cover" : "part1",
      title: `Diapo ${i + 1}`,
    })),
  };
}

function titles(deck: DeckSpec): string[] {
  return deck.slides.map((s) => s.title);
}

describe("bornes du diaporama", () => {
  it("devrait exposer 2 et 60 diapos comme bornes", () => {
    expect(MIN_DECK_SLIDES).toBe(2);
    expect(MAX_DECK_SLIDES).toBe(60);
  });
});

describe("insertSlide", () => {
  it("devrait insérer la diapo à l'index donné et décaler la suite", () => {
    const result = insertSlide(deckOf(3), 1, { ...newSlide, title: "Insérée" });
    expect(titles(result)).toEqual(["Diapo 1", "Insérée", "Diapo 2", "Diapo 3"]);
  });

  it("devrait accepter l'insertion en fin de diaporama quand l'index vaut la longueur", () => {
    const result = insertSlide(deckOf(3), 3, { ...newSlide, title: "Fin" });
    expect(titles(result)).toEqual(["Diapo 1", "Diapo 2", "Diapo 3", "Fin"]);
  });

  it("ne devrait pas muter le deck reçu", () => {
    const deck = makeConformingDeck();
    insertSlide(deck, 2, newSlide);
    expect(deck).toEqual(makeConformingDeck());
  });

  it("devrait refuser une 61e diapo avec le code TOO_MANY_SLIDES", () => {
    expect(() => insertSlide(deckOf(60), 5, newSlide)).toThrow(expect.objectContaining({ code: "TOO_MANY_SLIDES" }));
  });

  it("devrait refuser l'insertion avant la couverture avec le code COVER_LOCKED", () => {
    expect(() => insertSlide(deckOf(3), 0, newSlide)).toThrow(expect.objectContaining({ code: "COVER_LOCKED" }));
  });

  it("devrait accepter l'index 0 quand le deck n'a pas de couverture", () => {
    expect(titles(insertSlide(deckOf(2, false), 0, { ...newSlide, title: "Tête" }))[0]).toBe("Tête");
  });

  it.each([-1, 4, 1.5, Number.NaN])("devrait lever une DeckEditError INDEX_OUT_OF_RANGE quand l'index vaut %s", (index) => {
    const act = () => insertSlide(deckOf(3), index, newSlide);
    expect(act).toThrow(DeckEditError);
    expect(act).toThrow(RangeError);
    expect(act).toThrow(expect.objectContaining({ code: "INDEX_OUT_OF_RANGE" }));
  });
});

describe("removeSlide", () => {
  it("devrait retirer la diapo à l'index donné", () => {
    expect(titles(removeSlide(deckOf(4), 2))).toEqual(["Diapo 1", "Diapo 2", "Diapo 4"]);
  });

  it("ne devrait pas muter le deck reçu", () => {
    const deck = makeConformingDeck();
    removeSlide(deck, 4);
    expect(deck).toEqual(makeConformingDeck());
  });

  it("devrait refuser de descendre sous 2 diapos avec le code TOO_FEW_SLIDES", () => {
    expect(() => removeSlide(deckOf(2), 1)).toThrow(expect.objectContaining({ code: "TOO_FEW_SLIDES" }));
  });

  it("devrait refuser de retirer la couverture avec le code COVER_LOCKED", () => {
    expect(() => removeSlide(deckOf(4), 0)).toThrow(expect.objectContaining({ code: "COVER_LOCKED" }));
  });

  it.each([-1, 4])("devrait lever INDEX_OUT_OF_RANGE quand l'index vaut %s", (index) => {
    expect(() => removeSlide(deckOf(4), index)).toThrow(expect.objectContaining({ code: "INDEX_OUT_OF_RANGE" }));
  });
});

describe("moveSlide", () => {
  it("devrait déplacer une diapo vers l'arrière", () => {
    expect(titles(moveSlide(deckOf(5), 1, 3))).toEqual(["Diapo 1", "Diapo 3", "Diapo 4", "Diapo 2", "Diapo 5"]);
  });

  it("devrait déplacer une diapo vers l'avant", () => {
    expect(titles(moveSlide(deckOf(5), 4, 1))).toEqual(["Diapo 1", "Diapo 5", "Diapo 2", "Diapo 3", "Diapo 4"]);
  });

  it("devrait renvoyer un deck identique quand l'origine égale la destination", () => {
    expect(moveSlide(deckOf(3), 2, 2)).toEqual(deckOf(3));
  });

  it("ne devrait pas muter le deck reçu", () => {
    const deck = makeConformingDeck();
    moveSlide(deck, 1, 5);
    expect(deck).toEqual(makeConformingDeck());
  });

  it.each([
    { from: 0, to: 2 },
    { from: 2, to: 0 },
  ])("devrait refuser de déplacer autour de la couverture ($from → $to) avec COVER_LOCKED", ({ from, to }) => {
    expect(() => moveSlide(deckOf(4), from, to)).toThrow(expect.objectContaining({ code: "COVER_LOCKED" }));
  });

  it.each([
    { from: -1, to: 1 },
    { from: 1, to: 4 },
  ])("devrait lever INDEX_OUT_OF_RANGE quand $from → $to sort des bornes", ({ from, to }) => {
    expect(() => moveSlide(deckOf(4), from, to)).toThrow(expect.objectContaining({ code: "INDEX_OUT_OF_RANGE" }));
  });
});

describe("duplicateDeckSpec", () => {
  it("devrait renvoyer une copie égale au deck d'origine", () => {
    expect(duplicateDeckSpec(makeConformingDeck())).toEqual(makeConformingDeck());
  });

  it("ne devrait partager aucun tableau ni objet avec l'original", () => {
    const deck = makeConformingDeck();
    const copy = duplicateDeckSpec(deck);
    expect(copy.slides).not.toBe(deck.slides);
    expect(copy.slides[1]).not.toBe(deck.slides[1]);
    expect(copy.slides[1]!.bullets).not.toBe(deck.slides[1]!.bullets);
  });
});
