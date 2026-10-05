import { describe, expect, it } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import type { PromptTemplate, Section } from "@/domain/schemas";
import {
  formatSeconds,
  parseDurationText,
  slideBudgetWarning,
  suggestSlideCount,
  templateTimings,
  totalSlides,
} from "@/domain/slides";
import { makeTemplate } from "@/test/fixtures";

describe("suggestSlideCount", () => {
  it.each([
    { minutes: 3, expected: 5 },
    { minutes: 7, expected: 5 },
    { minutes: 9, expected: 6 },
    { minutes: 15, expected: 10 },
    { minutes: 20, expected: 13 },
    { minutes: 45, expected: 30 },
    { minutes: 46, expected: 30 },
    { minutes: 90, expected: 30 },
  ])("devrait conseiller $expected diapos quand l'oral dure $minutes min", ({ minutes, expected }) => {
    expect(suggestSlideCount(minutes)).toBe(expected);
  });
});

describe("totalSlides", () => {
  it("devrait compter la couverture plus la somme des diapos de chaque section", () => {
    // 1 couverture + 1 + 1 + 2 + 3 + 1
    expect(totalSlides(makeTemplate())).toBe(9);
  });

  it("devrait renvoyer 2 quand le gabarit n'a qu'une section d'une diapo", () => {
    const template = makeTemplate({ sections: [{ id: "only", title: "Unique", guidance: "", slides: 1 }] });
    expect(totalSlides(template)).toBe(2);
  });
});

describe("slideBudgetWarning — écart au nombre de diapos conseillé, explicite", () => {
  it("ne devrait rien dire sous 30 % d'écart", () => {
    expect(slideBudgetWarning(13, 20)).toBeNull();
    expect(slideBudgetWarning(16, 20)).toBeNull();
  });

  it("devrait chiffrer le rythme réel et le repère pour 31 diapos en 20 min (+138 %)", () => {
    const w = slideBudgetWarning(31, 20)!;
    expect(w).toMatch(/31 diapos pour 20 min/);
    expect(w).toMatch(/~39 s par diapo/);
    expect(w).toMatch(/13 diapos/);
    expect(w).toMatch(/\+138 %/);
    expect(w).toMatch(/enregistrer/);
  });

  it("devrait signaler un deck trop court pour la durée (4 diapos en 20 min)", () => {
    const w = slideBudgetWarning(4, 20)!;
    expect(w).toMatch(/4 diapos pour 20 min/);
    expect(w).toMatch(/5 min par diapo/);
    expect(w).toMatch(/-69 %/);
  });
});

/**
 * Minutage v1.0.1 (prompts.ts `templateLines`, free/skeleton.ts `buildDeck`), recopié ici
 * pour vérifier que la nouvelle fonction le reproduit à l'identique sans durée saisie.
 */
function legacyTimings(template: PromptTemplate) {
  const total = totalSlides(template);
  const totalSeconds = template.durationMinutes * 60;
  const coverSeconds = Math.min(30, totalSeconds / total);
  const perSlide = (totalSeconds - coverSeconds) / Math.max(1, total - 1);
  const slides = Array.from({ length: total - 1 }, (_, i) => ({
    start: coverSeconds + i * perSlide,
    end: coverSeconds + (i + 1) * perSlide,
  }));
  let cursor = coverSeconds;
  const sections = template.sections.map((section) => {
    const start = cursor;
    cursor += section.slides * perSlide;
    return { id: section.id, start, end: cursor };
  });
  return { cover: { start: 0, end: coverSeconds }, slides, sections };
}

function line(id: string, slides: number, seconds?: number): Section {
  return { id, title: id, guidance: "", slides, ...(seconds === undefined ? {} : { seconds }) };
}

describe("templateTimings — minutage de la trame", () => {
  it("devrait reproduire exactement le minutage v1.0.1 de la trame par défaut (couverture 0:30, puis pas égal)", () => {
    const timings = templateTimings(defaultTemplate());
    const legacy = legacyTimings(defaultTemplate());
    expect(timings.cover).toEqual({ start: 0, end: 30 });
    expect(timings.slides).toHaveLength(12);
    timings.slides.forEach((span, i) => {
      expect(span.start).toBeCloseTo(legacy.slides[i]!.start, 9);
      expect(span.end).toBeCloseTo(legacy.slides[i]!.end, 9);
    });
    expect(timings.sections.map((s) => s.id)).toEqual(legacy.sections.map((s) => s.id));
    timings.sections.forEach((span, i) => {
      expect(span.start).toBeCloseTo(legacy.sections[i]!.start, 9);
      expect(span.end).toBeCloseTo(legacy.sections[i]!.end, 9);
    });
    expect(timings.slides.at(-1)!.end).toBeCloseTo(1200, 9);
  });

  it("devrait reproduire le minutage v1.0.1 d'un oral court où la couverture fait moins de 30 s", () => {
    // 3 min, 9 diapos : couverture = 180 / 9 = 20 s.
    const template = makeTemplate({ durationMinutes: 3 });
    const timings = templateTimings(template);
    const legacy = legacyTimings(template);
    expect(timings.cover.end).toBeCloseTo(20, 9);
    timings.slides.forEach((span, i) => expect(span.end).toBeCloseTo(legacy.slides[i]!.end, 9));
  });

  it("devrait donner leur durée aux lignes minutées et partager le reste entre les diapos des autres", () => {
    // 10 min = 600 s, 5 diapos : couverture 30 s ; reste 600 − 30 − 180 = 390 s pour les 2 diapos de « b ».
    const template = makeTemplate({ durationMinutes: 10, sections: [line("a", 1, 120), line("b", 2), line("c", 1, 60)] });
    const timings = templateTimings(template);
    expect(timings.cover).toEqual({ start: 0, end: 30 });
    expect(timings.slides).toEqual([
      { start: 30, end: 150 },
      { start: 150, end: 345 },
      { start: 345, end: 540 },
      { start: 540, end: 600 },
    ]);
    expect(timings.sections).toEqual([
      { id: "a", start: 30, end: 150 },
      { id: "b", start: 150, end: 540 },
      { id: "c", start: 540, end: 600 },
    ]);
  });

  it("devrait répartir la durée d'une ligne minutée entre ses diapos", () => {
    const template = makeTemplate({ durationMinutes: 5, sections: [line("a", 2, 120), line("b", 1)] });
    const timings = templateTimings(template);
    expect(timings.slides.slice(0, 2)).toEqual([
      { start: 30, end: 90 },
      { start: 90, end: 150 },
    ]);
    expect(timings.slides[2]).toEqual({ start: 150, end: 300 });
  });

  it("devrait borner le reste à 0 quand les durées dépassent le temps disponible", () => {
    // 10 min : disponible 570 s, durées 700 s. Valeur hors schéma, mais le calcul ne doit pas reculer.
    const template = makeTemplate({ durationMinutes: 10, sections: [line("a", 1, 400), line("b", 1), line("c", 1, 300)] });
    const timings = templateTimings(template);
    expect(timings.slides).toEqual([
      { start: 30, end: 430 },
      { start: 430, end: 430 },
      { start: 430, end: 730 },
    ]);
  });
});

describe("formatSeconds", () => {
  it.each([
    [210, "3:30"],
    [30, "0:30"],
    [3600, "60:00"],
    [0, "0:00"],
    [97.5, "1:38"],
    [59.6, "1:00"],
  ])("%s s → %s", (seconds, expected) => {
    expect(formatSeconds(seconds)).toBe(expected);
  });
});

describe("parseDurationText", () => {
  it.each([
    ["3:30", 210],
    ["0:30", 30],
    ["12:05", 725],
    ["3 min", 180],
    ["3min", 180],
    ["3 MIN", 180],
    ["3 min 30", 210],
    ["3 min 30 s", 210],
    ["3min30s", 210],
    ["3'30", 210],
    ["3’30", 210],
    ["3'", 180],
    ["90 s", 90],
    ["90s", 90],
    ["90 sec", 90],
    ["1h05", 3900],
    ["1 h 05", 3900],
    ["1H05", 3900],
    ["  3:30  ", 210],
  ] as const)("devrait lire « %s » comme %i s", (text, expected) => {
    expect(parseDurationText(text)).toBe(expected);
  });

  it.each(["", "   ", "0:00", "0 min", "-3:30", "-90 s", "3:", "3:7", "3:75", "abc", "3", "3 min 75", "trois minutes", "3:30:00"])(
    "devrait refuser « %s »",
    (text) => {
      expect(parseDurationText(text)).toBeNull();
    },
  );
});
