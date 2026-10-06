import { describe, expect, it } from "vitest";
import { NONE, OTHER, parseDraft, restoreDraft, selectedSubject, subjectMode, type Draft } from "@/components/day/journey";

const DRAFT: Draft = {
  problem: "Comment financer la transition des PME ?",
  hintedThemeId: "",
  stage: "chosen",
  result: null,
  choice: "t1",
  otherThemeId: "",
};

describe("subjectMode — parcours selon le nombre de sujets", () => {
  it("devrait distinguer 0, 1 et plusieurs sujets", () => {
    expect(subjectMode(0)).toBe("none");
    expect(subjectMode(1)).toBe("single");
    expect(subjectMode(2)).toBe("many");
    expect(subjectMode(9)).toBe("many");
  });
});

describe("selectedSubject — sujet envoyé à la génération", () => {
  it("devrait envoyer null pour « Sans sujet »", () => {
    expect(selectedSubject(NONE, "")).toBeNull();
  });

  it("devrait envoyer le sujet coché, ou celui de la liste pour « Un autre sujet »", () => {
    expect(selectedSubject("t1", "")).toBe("t1");
    expect(selectedSubject(OTHER, "t2")).toBe("t2");
  });

  it("devrait ne rien envoyer tant que rien n'est choisi (jamais undefined vers le serveur)", () => {
    expect(selectedSubject("", "")).toBeUndefined();
    expect(selectedSubject(OTHER, "")).toBeUndefined();
  });
});

describe("parseDraft — brouillon lu dans sessionStorage", () => {
  it("devrait relire un brouillon complet", () => {
    expect(parseDraft(JSON.parse(JSON.stringify(DRAFT)))).toEqual(DRAFT);
  });

  it("devrait refuser une valeur sans problématique", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ stage: "chosen" })).toBeNull();
    expect(parseDraft("texte")).toBeNull();
  });

  it("devrait compléter un brouillon antérieur au moteur gratuit (source, repli)", () => {
    const parsed = parseDraft({
      ...DRAFT,
      result: { reformulatedProblem: "R", ranked: [{ themeId: "t1", themeName: "A", confidence: 0.5, rationale: "" }] },
    });
    expect(parsed?.result).toMatchObject({ source: "ai", fallbackReason: null });
  });
});

describe("restoreDraft — brouillon confronté aux sujets actuels", () => {
  it("devrait garder un choix valide", () => {
    expect(restoreDraft(DRAFT, ["t1", "t2"])).toEqual(DRAFT);
    expect(restoreDraft({ ...DRAFT, choice: NONE }, [])).toEqual({ ...DRAFT, choice: NONE });
    expect(restoreDraft({ ...DRAFT, choice: OTHER, otherThemeId: "t2" }, ["t1", "t2"])).toMatchObject({ stage: "chosen" });
  });

  it("devrait revenir à l'étape 1, problématique conservée, pour un choix inconnu (sujet supprimé, ancien brouillon)", () => {
    for (const choice of ["t9", "", OTHER]) {
      const restored = restoreDraft({ ...DRAFT, choice, otherThemeId: "t9" }, ["t1", "t2"]);
      expect(restored).toEqual({ ...DRAFT, stage: "input", choice: "", otherThemeId: "", result: null });
    }
  });

  it("devrait revenir à l'étape 1 si un sujet était choisi mais que le projet n'en a plus", () => {
    expect(restoreDraft(DRAFT, [])).toMatchObject({ stage: "input", problem: DRAFT.problem });
  });

  it("devrait oublier un sujet indiqué qui n'existe plus et les sujets reconnus supprimés depuis", () => {
    const restored = restoreDraft(
      {
        ...DRAFT,
        hintedThemeId: "t9",
        result: {
          reformulatedProblem: "R",
          ranked: [
            { themeId: "t9", themeName: "Supprimé", confidence: 0.6, rationale: "" },
            { themeId: "t1", themeName: "A", confidence: 0.3, rationale: "" },
          ],
          source: "ai",
          fallbackReason: null,
        },
      },
      ["t1", "t2"],
    );
    expect(restored?.hintedThemeId).toBe("");
    expect(restored?.result?.ranked.map((r) => r.themeId)).toEqual(["t1"]);
  });

  it("devrait laisser passer l'absence de brouillon", () => {
    expect(restoreDraft(null, ["t1"])).toBeNull();
  });
});
