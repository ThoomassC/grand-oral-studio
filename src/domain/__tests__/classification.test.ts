import { describe, expect, it } from "vitest";
import { normalizeClassification } from "@/domain/classification";
import { makeClassification, makeThemes } from "@/test/fixtures";

const themes = makeThemes();

function candidate(themeId: string, confidence: number, rationale = `raison ${themeId}`) {
  return { themeId, confidence, rationale };
}

describe("normalizeClassification", () => {
  it("devrait conserver la problématique reformulée par l'IA", () => {
    const raw = makeClassification([candidate("theme-ville", 0.8)]);
    expect(normalizeClassification(raw, themes).reformulatedProblem).toBe(raw.reformulatedProblem);
  });

  it("devrait écarter les themeId inconnus du programme", () => {
    const raw = makeClassification([candidate("theme-inexistant", 0.9), candidate("theme-ville", 0.6)]);
    expect(normalizeClassification(raw, themes).ranked.map((r) => r.themeId)).toEqual(["theme-ville"]);
  });

  it("devrait renseigner themeName à partir des thèmes du programme", () => {
    const raw = makeClassification([candidate("theme-numerique", 0.7)]);
    expect(normalizeClassification(raw, themes).ranked[0].themeName).toBe("Société numérique");
  });

  it("devrait dédoublonner un thème en gardant sa confiance maximale", () => {
    const raw = makeClassification([candidate("theme-ville", 0.4), candidate("theme-ville", 0.9), candidate("theme-ville", 0.6)]);
    const { ranked } = normalizeClassification(raw, themes);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].confidence).toBe(0.9);
  });

  it.each([
    { input: 1.7, expected: 1 },
    { input: -0.3, expected: 0 },
    { input: 0.876, expected: 0.88 },
    { input: 0.123, expected: 0.12 },
  ])("devrait ramener une confiance de $input à $expected", ({ input, expected }) => {
    const raw = makeClassification([candidate("theme-energie", input)]);
    expect(normalizeClassification(raw, themes).ranked[0].confidence).toBe(expected);
  });

  it("devrait trier les candidats par confiance décroissante", () => {
    const raw = makeClassification([candidate("theme-energie", 0.2), candidate("theme-ville", 0.9), candidate("theme-numerique", 0.5)]);
    expect(normalizeClassification(raw, themes).ranked.map((r) => r.themeId)).toEqual(["theme-ville", "theme-numerique", "theme-energie"]);
  });

  it("devrait garder au plus 3 candidats, les plus confiants", () => {
    const fourThemes = [...themes, { id: "theme-sante", name: "Santé publique", description: "", keywords: [], notes: "" }];
    const raw = makeClassification([
      candidate("theme-energie", 0.1),
      candidate("theme-ville", 0.9),
      candidate("theme-numerique", 0.5),
      candidate("theme-sante", 0.7),
    ]);
    expect(normalizeClassification(raw, fourThemes).ranked.map((r) => r.themeId)).toEqual(["theme-ville", "theme-sante", "theme-numerique"]);
  });

  it("devrait renvoyer ranked vide sans lever quand aucun candidat n'est valide", () => {
    const raw = makeClassification([candidate("inconnu-1", 0.9), candidate("inconnu-2", 0.5)]);
    expect(normalizeClassification(raw, themes).ranked).toEqual([]);
  });

  it("devrait placer en tête le thème annoncé quand il figure déjà parmi les candidats", () => {
    const raw = makeClassification([candidate("theme-ville", 0.9), candidate("theme-energie", 0.3)]);
    expect(normalizeClassification(raw, themes, "theme-energie").ranked[0].themeId).toBe("theme-energie");
  });

  it("devrait ajouter le thème annoncé quand l'IA ne l'a pas proposé", () => {
    const raw = makeClassification([candidate("theme-ville", 0.9)]);
    const { ranked } = normalizeClassification(raw, themes, "theme-numerique");
    expect(ranked.map((r) => r.themeId)).toContain("theme-numerique");
    expect(ranked.find((r) => r.themeId === "theme-numerique")?.themeName).toBe("Société numérique");
  });

  it("devrait ajouter le thème annoncé sans dépasser 3 candidats quand l'IA en propose déjà 3 autres", () => {
    const fourThemes = [...themes, { id: "theme-sante", name: "Santé publique", description: "", keywords: [], notes: "" }];
    const raw = makeClassification([candidate("theme-ville", 0.9), candidate("theme-numerique", 0.8), candidate("theme-energie", 0.7)]);
    const { ranked } = normalizeClassification(raw, fourThemes, "theme-sante");
    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.themeId)).toContain("theme-sante");
  });

  it("devrait ignorer un thème annoncé inconnu du programme", () => {
    const raw = makeClassification([candidate("theme-ville", 0.9)]);
    expect(normalizeClassification(raw, themes, "theme-inexistant").ranked.map((r) => r.themeId)).toEqual(["theme-ville"]);
  });

  it("devrait se comporter comme sans indice quand hintedThemeId vaut null", () => {
    const raw = makeClassification([candidate("theme-energie", 0.3), candidate("theme-ville", 0.9)]);
    expect(normalizeClassification(raw, themes, null)).toEqual(normalizeClassification(raw, themes));
  });
});
