import { describe, expect, it } from "vitest";
import { checkDeckAgainstTemplate, completeThinNotes, replaceSlide } from "@/domain/deck";
import { DeckSpecSchema, LIMITS, type DeckSpec, type Slide } from "@/domain/schemas";
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

  it("devrait signaler une section du gabarit absente du deck en citant son titre", () => {
    const deck = makeConformingDeck();
    const withoutConclusion: DeckSpec = { ...deck, slides: deck.slides.filter((s) => s.sectionId !== "conclusion") };
    const issues = checkDeckAgainstTemplate(withoutConclusion, makeTemplate());
    expect(issues.some((issue) => issue.includes("« Conclusion »"))).toBe(true);
  });

  it("devrait signaler une section dont le nombre de diapos diffère du gabarit en citant son titre", () => {
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

describe("completeThinNotes", () => {
  const rich = "Je commence par une situation que chacun connaît. Elle montre l'enjeu du sujet. J'annonce ensuite la question.";

  it("devrait compléter depuis le squelette les notes vides ou réduites à une consigne, en gardant le minutage du deck", () => {
    const skeleton = makeConformingDeck();
    skeleton.slides[0] = { ...skeleton.slides[0]!, notes: `[0:00–0:30] ${rich}` };
    skeleton.slides[1] = { ...skeleton.slides[1]!, notes: rich };
    const deck = makeConformingDeck();
    deck.slides[0] = { ...deck.slides[0]!, notes: "" };
    deck.slides[1] = { ...deck.slides[1]!, notes: "[0:30–2:00] Présentez le contexte." };
    const { deck: out, filled } = completeThinNotes(deck, skeleton);
    expect(filled).toEqual([1, 2]);
    expect(out.slides[0]!.notes).toBe(`[0:00–0:30] ${rich}`);
    expect(out.slides[1]!.notes).toBe(`[0:30–2:00] ${rich}`);
    // Les autres diapos et l'entrée sont intactes.
    expect(out.slides[2]).toEqual(deck.slides[2]);
    expect(deck.slides[0]!.notes).toBe("");
  });

  it("ne devrait rien reprendre d'une diapo du squelette d'une autre section, ni sans squelette", () => {
    const skeleton = makeConformingDeck();
    skeleton.slides[1] = { ...skeleton.slides[1]!, sectionId: "autre", notes: rich };
    const deck = makeConformingDeck();
    deck.slides[1] = { ...deck.slides[1]!, notes: "" };
    expect(completeThinNotes(deck, skeleton).filled).toEqual([]);
    expect(completeThinNotes(deck, null)).toEqual({ deck, filled: [], skippedSections: [] });
  });

  it("devrait borner la note complétée à LIMITS.notes pour que le deck reste valide", () => {
    const longSpoken = `${"Une phrase rédigée qui développe longuement le propos. ".repeat(60)}`.trim();
    const skeleton = makeConformingDeck();
    skeleton.slides[1] = { ...skeleton.slides[1]!, notes: longSpoken.slice(0, LIMITS.notes) };
    const deck = makeConformingDeck();
    // Minutage long côté deck : la concaténation « minutage + texte » dépasserait la borne.
    deck.slides[1] = { ...deck.slides[1]!, notes: "[0:30–2:00 environ, prendre son temps]" };
    const { deck: out, filled } = completeThinNotes(deck, skeleton);
    expect(filled).toEqual([2]);
    expect(out.slides[1]!.notes.length).toBeLessThanOrEqual(LIMITS.notes);
    expect(out.slides[1]!.notes.startsWith("[0:30–2:00 environ, prendre son temps] Une phrase")).toBe(true);
    expect(DeckSpecSchema.safeParse(out).success).toBe(true);
  });

  it("devrait aligner par rang au sein de la section, sans décaler les notes quand l'IA omet une diapo ailleurs", () => {
    const skeleton = makeConformingDeck();
    skeleton.slides = skeleton.slides.map((s, i) => ({ ...s, notes: `${rich} (squelette ${i})` }));
    // L'IA a omis la première diapo de part1 : toutes les diapos suivantes sont décalées d'un cran.
    const deck = makeConformingDeck();
    deck.slides = deck.slides.filter((_, i) => i !== 3).map((s) => ({ ...s, notes: "" }));
    const { deck: out, filled, skippedSections } = completeThinNotes(deck, skeleton);
    // part2 (rangs 0..2) reprend bien les notes des diapos 5, 6, 7 du squelette.
    const part2 = out.slides.filter((s) => s.sectionId === "part2").map((s) => s.notes);
    expect(part2).toEqual([`${rich} (squelette 5)`, `${rich} (squelette 6)`, `${rich} (squelette 7)`]);
    const conclusion = out.slides.find((s) => s.sectionId === "conclusion")!;
    expect(conclusion.notes).toBe(`${rich} (squelette 8)`);
    // part1 (1 diapo au lieu de 2) : rien de complété, section signalée.
    expect(out.slides.filter((s) => s.sectionId === "part1").map((s) => s.notes)).toEqual([""]);
    expect(skippedSections).toEqual(["part1"]);
    expect(filled).not.toContain(4);
  });

  it("ne devrait rien compléter dans une section où l'IA a ajouté une diapo", () => {
    const skeleton = makeConformingDeck();
    skeleton.slides = skeleton.slides.map((s) => ({ ...s, notes: rich }));
    const deck = makeConformingDeck();
    const extra = { ...deck.slides[5]!, title: "Diapo en trop" };
    deck.slides = [...deck.slides.slice(0, 6), extra, ...deck.slides.slice(6)].map((s) => ({ ...s, notes: "" }));
    const { deck: out, skippedSections } = completeThinNotes(deck, skeleton);
    expect(skippedSections).toEqual(["part2"]);
    expect(out.slides.filter((s) => s.sectionId === "part2").every((s) => s.notes === "")).toBe(true);
    expect(out.slides.find((s) => s.sectionId === "conclusion")!.notes).toBe(rich);
  });
});
