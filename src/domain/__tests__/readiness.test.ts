import { describe, expect, it } from "vitest";
import { isExamReady, READY_MIN_DECKS, READY_MIN_REHEARSALS } from "@/domain/readiness";

describe("isExamReady", () => {
  it("devrait exiger 2 diaporamas et 2 répétitions", () => {
    expect(READY_MIN_DECKS).toBe(2);
    expect(READY_MIN_REHEARSALS).toBe(2);
  });

  it.each([
    { decks: 2, rehearsals: 2, ready: true },
    { decks: 5, rehearsals: 9, ready: true },
    { decks: 1, rehearsals: 5, ready: false },
    { decks: 5, rehearsals: 1, ready: false },
    { decks: 0, rehearsals: 0, ready: false },
    { decks: Number.NaN, rehearsals: 3, ready: false },
    { decks: Number.POSITIVE_INFINITY, rehearsals: 3, ready: false },
  ])("devrait juger $decks diaporamas et $rehearsals répétitions prêt : $ready", ({ decks, rehearsals, ready }) => {
    expect(isExamReady({ decks, rehearsals })).toBe(ready);
  });
});
