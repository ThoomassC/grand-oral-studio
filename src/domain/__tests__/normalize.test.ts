import { describe, expect, it } from "vitest";
import {
  normalizeDeckSpec,
  normalizeRawClassification,
  RawClassificationSchema,
  RawDeckSpecSchema,
  truncateText,
} from "@/domain/normalize";
import { ClassificationSchema, DeckSpecSchema } from "@/domain/schemas";
import { makeConformingDeck } from "@/test/fixtures";

describe("truncateText", () => {
  it("devrait laisser intact un texte qui tient", () => {
    expect(truncateText("Bonjour", 10)).toBe("Bonjour");
  });

  it("devrait couper à la frontière de mot et terminer par une ellipse", () => {
    const out = truncateText("Une phrase beaucoup trop longue pour la limite", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("Une phrase beaucoup…");
  });

  it("devrait couper au caractère quand il n'y a pas d'espace", () => {
    const out = truncateText("x".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("normalizeDeckSpec", () => {
  it("devrait laisser un deck conforme strictement inchangé", () => {
    expect(normalizeDeckSpec(RawDeckSpecSchema.parse(makeConformingDeck()))).toEqual(makeConformingDeck());
  });

  it("devrait ramener une réponse trop longue dans les bornes de DeckSpecSchema", () => {
    const deck = makeConformingDeck();
    const raw = RawDeckSpecSchema.parse({
      ...deck,
      title: "T".repeat(400),
      subtitle: "S ".repeat(300),
      slides: deck.slides.map((s, i) =>
        i === 1
          ? {
              ...s,
              title: "Un titre ".repeat(40),
              subtitle: "x".repeat(500),
              bullets: [...Array.from({ length: 9 }, (_, k) => `Puce ${k} ${"mot ".repeat(80)}`), "", "   "],
              notes: "n".repeat(5000),
            }
          : s,
      ),
    });
    const out = normalizeDeckSpec(raw);
    const strict = DeckSpecSchema.safeParse(out);
    expect(strict.success).toBe(true);
    expect(out.title.length).toBeLessThanOrEqual(160);
    const slide = out.slides[1]!;
    expect(slide.bullets).toHaveLength(6);
    expect(slide.bullets.every((b) => b.length <= 180)).toBe(true);
    expect(slide.bullets[0]!.startsWith("Puce 0")).toBe(true);
    expect(slide.title.length).toBeLessThanOrEqual(140);
    expect(slide.notes.length).toBeLessThanOrEqual(3000);
  });

  it("devrait retirer les caractères de contrôle et les puces vides", () => {
    const deck = makeConformingDeck();
    const raw = RawDeckSpecSchema.parse({
      ...deck,
      slides: deck.slides.map((s, i) => (i === 1 ? { ...s, title: "A\u0000B", bullets: ["\u0007", "ok\u001F"] } : s)),
    });
    const slide = normalizeDeckSpec(raw).slides[1]!;
    expect(slide.title).toBe("AB");
    expect(slide.bullets).toEqual(["ok"]);
  });

  it("devrait donner un titre de repli à une diapo sans titre", () => {
    const deck = makeConformingDeck();
    const raw = RawDeckSpecSchema.parse({ ...deck, slides: deck.slides.map((s, i) => (i === 2 ? { ...s, title: "  " } : s)) });
    expect(normalizeDeckSpec(raw).slides[2]!.title).toBe("Diapo 3");
  });

  it("devrait ramener un layout inconnu à « content » (« title » pour la première diapo)", () => {
    const deck = makeConformingDeck();
    const raw = RawDeckSpecSchema.parse({
      ...deck,
      slides: deck.slides.map((s, i) => (i === 0 ? { ...s, layout: "cover" } : i === 1 ? { ...s, layout: "Two-Columns" } : i === 2 ? { ...s, layout: "bizarre" } : s)),
    });
    const out = normalizeDeckSpec(raw);
    expect(out.slides.slice(0, 3).map((s) => s.layout)).toEqual(["title", "two-columns", "content"]);
  });

  it("devrait garder au plus 60 diapos", () => {
    const deck = makeConformingDeck();
    const many = Array.from({ length: 80 }, (_, i) => ({ ...deck.slides[1]!, title: `D${i}` }));
    const out = normalizeDeckSpec(RawDeckSpecSchema.parse({ ...deck, slides: [deck.slides[0]!, ...many] }));
    expect(out.slides).toHaveLength(60);
  });

  it("devrait tolérer des champs facultatifs absents", () => {
    const raw = RawDeckSpecSchema.parse({
      title: "Deck",
      slides: [
        { layout: "title", sectionId: "cover", title: "Couverture" },
        { layout: "content", sectionId: "intro", title: "Intro" },
      ],
    });
    expect(DeckSpecSchema.safeParse(normalizeDeckSpec(raw)).success).toBe(true);
  });
});

describe("normalizeRawClassification", () => {
  it("devrait tronquer la reformulation et les justifications et garder 10 candidats", () => {
    const raw = RawClassificationSchema.parse({
      reformulatedProblem: "r".repeat(900),
      candidates: Array.from({ length: 14 }, (_, i) => ({ themeId: `t${i}`, confidence: 0.5, rationale: "x".repeat(900) })),
    });
    const out = normalizeRawClassification(raw);
    expect(ClassificationSchema.safeParse(out).success).toBe(true);
    expect(out.candidates).toHaveLength(10);
  });
});
