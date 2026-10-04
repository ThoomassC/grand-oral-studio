import { describe, expect, it } from "vitest";
import { computeProjectProgress, type PrepareItemId, type ProjectProgress, type StepId } from "@/domain/progress";

const EMPTY = { themeCount: 0, brandSavedAt: null, templateSavedAt: null, skeletonCount: 0, finalDeckCount: 0 };
const SAVED = "2026-10-01T10:00:00.000Z";
const TPL = { slides: 13, durationMinutes: 20 };
const FULL = { themeCount: 9, brandSavedAt: SAVED, templateSavedAt: SAVED, skeletonCount: 9, finalDeckCount: 2, template: TPL };

function step(p: ProjectProgress, id: StepId) {
  const s = p.steps.find((x) => x.id === id);
  if (!s) throw new Error(`étape ${id} absente`);
  return s;
}
function item(p: ProjectProgress, id: PrepareItemId) {
  const i = p.prepare.find((x) => x.id === id);
  if (!i) throw new Error(`élément ${id} absent`);
  return i;
}

describe("computeProjectProgress — structure", () => {
  it("devrait renvoyer les 3 étapes dans l'ordre, indexées de 1 à 3", () => {
    const p = computeProjectProgress(EMPTY);
    expect(p.steps.map((s) => [s.id, s.index])).toEqual([
      ["prepare", 1],
      ["skeletons", 2],
      ["day", 3],
    ]);
    expect(p.total).toBe(3);
  });

  it("devrait détailler la préparation : thèmes (requis), charte et gabarit (facultatifs), dans cet ordre", () => {
    const p = computeProjectProgress(EMPTY);
    expect(p.prepare.map((i) => [i.id, i.required])).toEqual([
      ["themes", true],
      ["brand", false],
      ["template", false],
    ]);
  });

  it("devrait tout marquer à faire pour un projet neuf, l'étape suivante étant la préparation", () => {
    const p = computeProjectProgress(EMPTY);
    expect(p.steps.every((s) => s.status === "todo")).toBe(true);
    expect(p).toMatchObject({ doneCount: 0, nextStep: "prepare" });
  });

  it("devrait tout marquer fait, sans étape suivante, pour un projet complet", () => {
    const p = computeProjectProgress(FULL);
    expect(p.steps.every((s) => s.status === "done")).toBe(true);
    expect(p).toMatchObject({ doneCount: 3, nextStep: null });
    expect(p.steps.every((s) => s.blockedBy === null)).toBe(true);
    expect(p.prepare.every((i) => i.status === "done")).toBe(true);
  });
});

describe("computeProjectProgress — préparation", () => {
  it("devrait être faite dès 1 thème, même avec la charte et le gabarit par défaut", () => {
    const p = computeProjectProgress({ ...EMPTY, themeCount: 1 });
    expect(step(p, "prepare").status).toBe("done");
    expect(item(p, "brand").status).toBe("default");
    expect(item(p, "template").status).toBe("default");
  });

  it("ne devrait jamais être faite sans thème, même avec charte et gabarit enregistrés", () => {
    const p = computeProjectProgress({ ...EMPTY, brandSavedAt: SAVED, templateSavedAt: SAVED });
    expect(step(p, "prepare").status).toBe("todo");
    expect(item(p, "themes").status).toBe("todo");
    expect(item(p, "brand").status).toBe("done");
    expect(item(p, "template").status).toBe("done");
  });

  it("thèmes : done dès 1 thème, sinon todo (jamais default)", () => {
    expect(item(computeProjectProgress({ ...EMPTY, themeCount: 2 }), "themes").status).toBe("done");
    expect(item(computeProjectProgress(EMPTY), "themes").status).toBe("todo");
  });

  it.each([
    [{}, "9 thèmes · charte et gabarit par défaut"],
    [{ brandSavedAt: SAVED }, "9 thèmes · charte personnalisée"],
    [{ templateSavedAt: SAVED }, "9 thèmes · gabarit personnalisé"],
    [{ brandSavedAt: SAVED, templateSavedAt: SAVED }, "9 thèmes · charte et gabarit personnalisés"],
  ])("résumé de la préparation (%o) → %s", (over, summary) => {
    expect(step(computeProjectProgress({ ...EMPTY, themeCount: 9, ...over }), "prepare").summary).toBe(summary);
  });

  it("résumé de la préparation sans thème : « Aucun thème »", () => {
    expect(step(computeProjectProgress({ ...EMPTY, brandSavedAt: SAVED }), "prepare").summary).toBe("Aucun thème");
  });

  it("résumé au singulier pour 1 thème", () => {
    expect(step(computeProjectProgress({ ...EMPTY, themeCount: 1 }), "prepare").summary).toBe("1 thème · charte et gabarit par défaut");
  });

  it.each([
    [0, "Aucun thème"],
    [1, "1 thème"],
    [9, "9 thèmes"],
  ])("élément thèmes : %i → %s", (themeCount, summary) => {
    expect(item(computeProjectProgress({ ...EMPTY, themeCount }), "themes").summary).toBe(summary);
  });

  it("élément charte : personnalisée ou par défaut", () => {
    expect(item(computeProjectProgress({ ...EMPTY, brandSavedAt: SAVED }), "brand").summary).toBe("Charte personnalisée");
    expect(item(computeProjectProgress(EMPTY), "brand").summary).toBe("Charte par défaut");
  });

  it("élément gabarit : diapos et durée, préfixé « Gabarit par défaut » s'il n'a jamais été enregistré", () => {
    expect(item(computeProjectProgress({ ...EMPTY, templateSavedAt: SAVED, template: TPL }), "template").summary).toBe("13 diapos · 20 min");
    expect(item(computeProjectProgress({ ...EMPTY, template: TPL }), "template").summary).toBe("Gabarit par défaut · 13 diapos · 20 min");
    expect(
      item(computeProjectProgress({ ...EMPTY, templateSavedAt: SAVED, template: { slides: 1, durationMinutes: 5 } }), "template").summary,
    ).toBe("1 diapo · 5 min");
  });

  it("élément gabarit sans détail fourni (liste des projets)", () => {
    expect(item(computeProjectProgress({ ...EMPTY, templateSavedAt: SAVED }), "template").summary).toBe("Gabarit personnalisé");
    expect(item(computeProjectProgress(EMPTY), "template").summary).toBe("Gabarit par défaut");
  });
});

describe("computeProjectProgress — squelettes et jour J", () => {
  it("squelettes : faits seulement quand chaque thème en a un", () => {
    expect(step(computeProjectProgress({ ...EMPTY, themeCount: 9, skeletonCount: 7 }), "skeletons").status).toBe("todo");
    expect(step(computeProjectProgress({ ...EMPTY, themeCount: 9, skeletonCount: 9 }), "skeletons").status).toBe("done");
  });

  it("squelettes : jamais faits sans thème (même avec un compteur incohérent)", () => {
    expect(step(computeProjectProgress({ ...EMPTY, skeletonCount: 3 }), "skeletons").status).toBe("todo");
  });

  it("jour J : fait dès 1 deck final", () => {
    expect(step(computeProjectProgress({ ...EMPTY, themeCount: 1, finalDeckCount: 1 }), "day").status).toBe("done");
    expect(step(computeProjectProgress({ ...EMPTY, themeCount: 1 }), "day").status).toBe("todo");
  });

  it.each([
    [9, 7, "7/9 squelettes"],
    [1, 0, "0/1 squelette"],
    [2, 5, "2/2 squelettes"],
    [0, 0, "Ajoutez d'abord des thèmes"],
  ])("résumé squelettes : %i thèmes, %i squelettes → %s", (themeCount, skeletonCount, summary) => {
    expect(step(computeProjectProgress({ ...EMPTY, themeCount, skeletonCount }), "skeletons").summary).toBe(summary);
  });

  it.each([
    [0, "Aucun diaporama"],
    [1, "1 diaporama"],
    [2, "2 diaporamas"],
  ])("résumé jour J : %i → %s", (finalDeckCount, summary) => {
    expect(step(computeProjectProgress({ ...EMPTY, themeCount: 1, finalDeckCount }), "day").summary).toBe(summary);
  });
});

describe("computeProjectProgress — blockedBy et nextStep", () => {
  it("devrait bloquer squelettes et jour J par la préparation tant qu'il n'y a aucun thème", () => {
    const p = computeProjectProgress(EMPTY);
    expect(p.steps.map((s) => [s.id, s.blockedBy])).toEqual([
      ["prepare", null],
      ["skeletons", "prepare"],
      ["day", "prepare"],
    ]);
  });

  it("ne devrait jamais bloquer à cause de la charte ou du gabarit", () => {
    const p = computeProjectProgress({ ...EMPTY, themeCount: 1 });
    expect(p.steps.map((s) => s.blockedBy)).toEqual([null, null, null]);
    expect(p.nextStep).toBe("skeletons");
  });

  it("devrait désigner la première étape non faite, même si une suivante est faite", () => {
    const p = computeProjectProgress({ ...EMPTY, themeCount: 3, skeletonCount: 1, finalDeckCount: 1 });
    expect(p).toMatchObject({ nextStep: "skeletons", doneCount: 2 });
  });

  it("devrait désigner le jour J quand préparation et squelettes sont faits", () => {
    expect(computeProjectProgress({ ...FULL, finalDeckCount: 0 }).nextStep).toBe("day");
  });
});

describe("computeProjectProgress — entrées hors bornes", () => {
  it("devrait traiter des compteurs négatifs ou NaN comme 0", () => {
    const p = computeProjectProgress({ ...EMPTY, themeCount: -2, skeletonCount: -1, finalDeckCount: Number.NaN });
    expect(step(p, "prepare").summary).toBe("Aucun thème");
    expect(step(p, "day").status).toBe("todo");
  });
});
