import { describe, expect, it } from "vitest";
import { suggestSlideCount, totalSlides } from "@/domain/slides";
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
