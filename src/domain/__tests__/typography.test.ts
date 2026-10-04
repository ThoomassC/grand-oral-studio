import { describe, expect, it } from "vitest";
import type { SlideLayout } from "@/domain/schemas";
import {
  bulletFontSizePt,
  estimateTextHeightIn,
  MIN_BODY_FONT_PT,
  slideGeometry,
  SLIDE_WIDTH_IN,
  slideHeightIn,
  splitColumns,
  titleFontSizePt,
} from "@/domain/typography";

const FORMATS = ["16:9", "4:3"] as const;
const BODY_LAYOUTS: SlideLayout[] = ["section", "content", "two-columns", "conclusion"];

/** Pire cas autorisé par SlideSchema : 6 puces de 180 caractères (mots de 7 lettres). */
const WORST_BULLETS = Array.from({ length: 6 }, () => "abcdefg ".repeat(23).slice(0, 180));
const WORST_TITLE = "Abcdefghij ".repeat(13).slice(0, 140);

describe("géométrie", () => {
  it("devrait exposer une diapo de 10 pouces de large aux ratios 16:9 et 4:3", () => {
    expect(SLIDE_WIDTH_IN).toBe(10);
    expect(SLIDE_WIDTH_IN / slideHeightIn("16:9")).toBeCloseTo(16 / 9, 3);
    expect(SLIDE_WIDTH_IN / slideHeightIn("4:3")).toBeCloseTo(4 / 3, 3);
  });

  it("devrait répartir les puces sur deux colonnes, la première prenant l'excédent", () => {
    expect(splitColumns(["a", "b", "c", "d", "e"])).toEqual([["a", "b", "c"], ["d", "e"]]);
  });
});

describe("bulletFontSizePt", () => {
  it("devrait grossir le texte quand il y a peu de puces", () => {
    expect(bulletFontSizePt(["Une"], "content", "16:9", false)).toBeGreaterThan(
      bulletFontSizePt(WORST_BULLETS, "content", "16:9", false),
    );
  });

  describe.each(FORMATS)("pire cas en %s", (format) => {
    it.each(BODY_LAYOUTS.flatMap((layout) => [true, false].map((hasSubtitle) => ({ layout, hasSubtitle }))))(
      "devrait tenir dans la zone en $layout (sous-titre : $hasSubtitle) à au moins 12 pt",
      ({ layout, hasSubtitle }) => {
        const size = bulletFontSizePt(WORST_BULLETS, layout, format, hasSubtitle);
        expect(size).toBeGreaterThanOrEqual(MIN_BODY_FONT_PT);
        expect(MIN_BODY_FONT_PT).toBeGreaterThanOrEqual(12);
        const geo = slideGeometry(layout, format, hasSubtitle, WORST_BULLETS);
        const columns = geo.body.length === 2 ? splitColumns(WORST_BULLETS) : [WORST_BULLETS];
        columns.forEach((bullets, i) => {
          const box = geo.body[i]!;
          expect(estimateTextHeightIn(bullets, size, box.w, { bullets: true })).toBeLessThanOrEqual(box.h);
        });
      },
    );
  });
});

describe("titleFontSizePt", () => {
  it("devrait réduire la taille quand le titre s'allonge", () => {
    expect(titleFontSizePt("Court", "content", "16:9")).toBeGreaterThan(titleFontSizePt(WORST_TITLE, "content", "16:9"));
  });

  describe.each(FORMATS)("pire cas en %s", (format) => {
    it.each(["title", ...BODY_LAYOUTS] as SlideLayout[])("devrait faire tenir un titre de 140 caractères en %s", (layout) => {
      const size = titleFontSizePt(WORST_TITLE, layout, format);
      expect(size).toBeGreaterThanOrEqual(16);
      const box = slideGeometry(layout, format, false, []).title;
      expect(estimateTextHeightIn([WORST_TITLE], size, box.w, { bold: true })).toBeLessThanOrEqual(box.h);
    });
  });
});
