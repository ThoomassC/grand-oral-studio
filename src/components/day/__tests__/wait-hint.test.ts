import { describe, expect, it } from "vitest";
import { generationWaitHint } from "@/components/day/wait-hint";

describe("generationWaitHint — temps d'attente annoncé selon le moteur", () => {
  it("ne devrait pas annoncer « 1 à 3 minutes » pour un modèle local (3 min 09 observées, jusqu'à 10 min)", () => {
    const hint = generationWaitHint("ollama");
    expect(hint).not.toMatch(/1 à 3 minutes/);
    expect(hint).toMatch(/10 minutes/);
  });

  it.each([
    ["claude", /1 à 3 minutes/],
    ["free", /quelques secondes/],
    ["mock", /quelques secondes/],
  ] as const)("%s → %s", (engine, expected) => {
    expect(generationWaitHint(engine)).toMatch(expected);
  });
});
