import { describe, expect, it } from "vitest";
import { checkDeckAgainstTemplate, replaceSlide } from "@/domain/deck";
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
  it("devrait renvoyer une liste vide quand le deck est conforme au gabarit", () => {
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

  it("devrait signaler une section du gabarit absente du deck en citant son id", () => {
    const deck = makeConformingDeck();
    const withoutConclusion: DeckSpec = { ...deck, slides: deck.slides.filter((s) => s.sectionId !== "conclusion") };
    const issues = checkDeckAgainstTemplate(withoutConclusion, makeTemplate());
    expect(issues.some((issue) => issue.includes("conclusion"))).toBe(true);
  });

  it("devrait signaler une section dont le nombre de diapos diffère du gabarit en citant son id", () => {
    const deck = makeConformingDeck();
    const firstPart2 = deck.slides.findIndex((s) => s.sectionId === "part2");
    const shortPart2: DeckSpec = { ...deck, slides: deck.slides.filter((_, i) => i !== firstPart2) };
    const issues = checkDeckAgainstTemplate(shortPart2, makeTemplate());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("part2");
  });

  it("devrait signaler une section qui a trop de diapos", () => {
    const deck = makeConformingDeck();
    const extra: Slide = { ...newSlide, sectionId: "intro" };
    const issues = checkDeckAgainstTemplate({ ...deck, slides: [...deck.slides.slice(0, 2), extra, ...deck.slides.slice(2)] }, makeTemplate());
    expect(issues.some((issue) => issue.includes("intro"))).toBe(true);
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
