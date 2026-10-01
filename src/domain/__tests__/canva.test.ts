import { describe, expect, it } from "vitest";
import { buildCanvaPrompt } from "@/domain/canva";
import { makeBrand, makeConformingDeck, makeTemplate, TINY_PNG_DATA_URL } from "@/test/fixtures";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const deck = makeConformingDeck();
const brand = makeBrand();

describe("buildCanvaPrompt", () => {
  it.each(Object.entries(brand.colors).map(([role, hex]) => ({ role, hex })))(
    "devrait contenir la couleur $role ($hex) de la charte",
    ({ hex }) => {
      expect(buildCanvaPrompt(deck, brand, makeTemplate()).toUpperCase()).toContain(hex.toUpperCase());
    },
  );

  it("devrait contenir les polices de titre et de texte de la charte", () => {
    const text = buildCanvaPrompt(deck, brand, makeTemplate());
    expect(text).toContain(brand.fonts.heading);
    expect(text).toContain(brand.fonts.body);
  });

  it.each(["16:9", "4:3"] as const)("devrait indiquer le format %s du gabarit", (format) => {
    expect(buildCanvaPrompt(deck, brand, makeTemplate({ format }))).toContain(format);
  });

  it.each(deck.slides.map((slide, index) => ({ number: index + 1, slide })))(
    "devrait numéroter la diapo $number sur la ligne de son titre et reprendre ses puces et notes",
    ({ number, slide }) => {
      const text = buildCanvaPrompt(deck, brand, makeTemplate());
      expect(text).toMatch(new RegExp(`\\b${number}\\b[^\\n]*${escapeRegExp(slide.title)}`));
      expect(slide.bullets.every((bullet) => text.includes(bullet))).toBe(true);
      expect(text).toContain(slide.notes);
    },
  );

  it("devrait présenter les diapos dans l'ordre du deck", () => {
    const text = buildCanvaPrompt(deck, brand, makeTemplate());
    // lastIndexOf : le titre du deck (identique à celui de la couverture) peut figurer en en-tête.
    const positions = deck.slides.map((slide) => text.lastIndexOf(slide.title));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("ne devrait jamais recopier le data URL du logo mais signaler qu'un logo est à placer", () => {
    const text = buildCanvaPrompt(deck, makeBrand({ logoDataUrl: TINY_PNG_DATA_URL }), makeTemplate());
    expect(text).not.toContain("data:image");
    expect(text).not.toContain("base64");
    expect(text).toMatch(/logo/i);
  });
});
