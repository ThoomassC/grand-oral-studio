import { describe, expect, it } from "vitest";
import {
  formatDelta,
  plannedSecondsPerSlide,
  rehearsalInputSchema,
  RehearsalInputSchema,
  summarizeRehearsal,
} from "@/domain/rehearsal";
import type { DeckSpec, Slide } from "@/domain/schemas";
import { makeConformingDeck, makeTemplate } from "@/test/fixtures";

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function withNotes(deck: DeckSpec, notes: Record<number, string>): DeckSpec {
  return { ...deck, slides: deck.slides.map((s, i) => (i in notes ? { ...s, notes: notes[i]! } : s)) };
}

const extra: Slide = { layout: "content", sectionId: "part1", title: "Ajoutée", subtitle: "", bullets: [], notes: "" };

describe("plannedSecondsPerSlide", () => {
  // makeTemplate : 20 min, 9 diapos ; couverture 30 s, puis 1170 s / 8 = 146,25 s par diapo.
  it("devrait suivre le minutage de la trame quand les notes n'ont pas de repère", () => {
    const planned = plannedSecondsPerSlide(makeConformingDeck(), makeTemplate());
    expect(planned).toHaveLength(9);
    expect(planned[0]).toBe(30);
    expect(planned.slice(1).every((s) => s === 146 || s === 147)).toBe(true);
  });

  it("devrait renvoyer des secondes entières dont la somme égale la durée de l'oral", () => {
    const planned = plannedSecondsPerSlide(makeConformingDeck(), makeTemplate());
    expect(planned.every(Number.isInteger)).toBe(true);
    expect(sum(planned)).toBe(1200);
  });

  it("devrait préférer le repère « [m:ss–m:ss] » des notes au minutage de la trame", () => {
    const deck = withNotes(makeConformingDeck(), { 1: "[0:30–3:00] Je pars d'une situation vécue." });
    expect(plannedSecondsPerSlide(deck, makeTemplate())[1]).toBe(150);
  });

  it.each(["[1:00-2:15] tiret simple", "[1:00 — 2:15] tiret cadratin", "  [1:00–2:15]"])(
    "devrait lire le repère « %s »",
    (notes) => {
      expect(plannedSecondsPerSlide(withNotes(makeConformingDeck(), { 2: notes }), makeTemplate())[2]).toBe(75);
    },
  );

  it("devrait ignorer un repère dont la fin précède le début", () => {
    const deck = withNotes(makeConformingDeck(), { 1: "[3:00–1:00] Inversé." });
    expect([146, 147]).toContain(plannedSecondsPerSlide(deck, makeTemplate())[1]);
  });

  it("devrait répartir la durée d'une ligne entre ses diapos quand une diapo y a été ajoutée", () => {
    const deck = makeConformingDeck();
    const edited: DeckSpec = { ...deck, slides: [...deck.slides.slice(0, 4), extra, ...deck.slides.slice(4)] };
    const planned = plannedSecondsPerSlide(edited, makeTemplate());
    // part1 : 2 × 146,25 s = 292,5 s, désormais sur 3 diapos (indices 3, 4, 5).
    expect(sum(planned.slice(3, 6))).toBeGreaterThanOrEqual(292);
    expect(sum(planned.slice(3, 6))).toBeLessThanOrEqual(293);
    expect(sum(planned)).toBe(1200);
  });

  it("devrait répartir la durée de l'oral également quand ni notes ni trame ne renseignent", () => {
    const deck: DeckSpec = { title: "Libre", subtitle: "", slides: Array.from({ length: 4 }, () => ({ ...extra, sectionId: "hors-trame" })) };
    expect(plannedSecondsPerSlide(deck, makeTemplate())).toEqual([300, 300, 300, 300]);
  });

  it("devrait donner aux diapos hors trame le temps que les autres n'utilisent pas", () => {
    const deck = makeConformingDeck();
    const [cover, intro] = deck.slides;
    const edited: DeckSpec = { ...deck, slides: [cover!, intro!, { ...extra, sectionId: "hors-trame" }] };
    // Couverture 30 s, intro 146,25 s : le reste (1023,75 s) va à la diapo hors trame.
    expect(plannedSecondsPerSlide(edited, makeTemplate())).toEqual([30, 146, 1024]);
  });
});

describe("summarizeRehearsal", () => {
  it("devrait totaliser et calculer l'écart de chaque diapo", () => {
    const summary = summarizeRehearsal([30, 150, 120], [40, 200, 100]);
    expect(summary.totalSeconds).toBe(340);
    expect(summary.plannedTotal).toBe(300);
    expect(summary.totalDelta).toBe(40);
    expect(summary.deltas).toEqual([
      { index: 0, delta: 10 },
      { index: 1, delta: 50 },
      { index: 2, delta: -20 },
    ]);
  });

  it("devrait signaler les dépassements au-delà de la tolérance (10 s ou 20 % du prévu)", () => {
    // Diapo 0 : +10 s = tolérance, non signalé ; diapo 1 : +50 s > 30 s, signalé.
    expect(summarizeRehearsal([30, 150, 120], [40, 200, 100]).overruns).toEqual([{ index: 1, delta: 50 }]);
  });

  it("devrait trier les dépassements du plus fort au plus faible", () => {
    const { overruns } = summarizeRehearsal([60, 60, 60], [90, 140, 75]);
    expect(overruns.map((o) => o.index)).toEqual([1, 0, 2]);
  });

  it("devrait lever une RangeError quand les tableaux n'ont pas la même longueur", () => {
    expect(() => summarizeRehearsal([30, 60], [30])).toThrow(RangeError);
  });
});

describe("formatDelta", () => {
  it.each([
    { sec: 70, text: "+1 min 10" },
    { sec: -20, text: "−20 s" },
    { sec: 0, text: "0 s" },
    { sec: 120, text: "+2 min" },
    { sec: 65, text: "+1 min 05" },
    { sec: -61, text: "−1 min 01" },
    { sec: 59.6, text: "+1 min" },
    { sec: 0.4, text: "0 s" },
    { sec: Number.NaN, text: "0 s" },
  ])("devrait écrire $sec s « $text »", ({ sec, text }) => {
    expect(formatDelta(sec)).toBe(text);
  });
});

describe("RehearsalInputSchema", () => {
  const valid = { totalSeconds: 600, perSlide: [60, 120, 400] };

  it("devrait accepter une répétition valide", () => {
    expect(RehearsalInputSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    { label: "durée nulle", input: { ...valid, totalSeconds: 0 } },
    { label: "durée au-delà de 2 h", input: { ...valid, totalSeconds: 7201 } },
    { label: "durée non entière", input: { ...valid, totalSeconds: 10.5 } },
    { label: "temps de diapo négatif", input: { ...valid, perSlide: [-1, 120, 400] } },
    { label: "temps de diapo non entier", input: { ...valid, perSlide: [1.5, 120, 400] } },
    { label: "plus de 60 diapos", input: { totalSeconds: 7200, perSlide: Array.from({ length: 61 }, () => 1) } },
    { label: "une seule diapo", input: { totalSeconds: 60, perSlide: [60] } },
    { label: "somme des diapos supérieure à la durée", input: { totalSeconds: 100, perSlide: [60, 60] } },
  ])("devrait refuser : $label", ({ input }) => {
    expect(RehearsalInputSchema.safeParse(input).success).toBe(false);
  });

  it("devrait tolérer un arrondi d'une seconde par diapo dans la somme", () => {
    expect(RehearsalInputSchema.safeParse({ totalSeconds: 100, perSlide: [51, 51] }).success).toBe(true);
  });

  it("devrait exiger autant de temps que de diapos du deck avec rehearsalInputSchema(n)", () => {
    expect(rehearsalInputSchema(3).safeParse(valid).success).toBe(true);
    expect(rehearsalInputSchema(4).safeParse(valid).success).toBe(false);
  });
});
