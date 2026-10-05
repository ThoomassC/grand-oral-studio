import { describe, expect, it } from "vitest";
import {
  computeProjectProgress,
  STEP_ORDER,
  type ProjectProgress,
  type StepId,
  type TemplateTabId,
} from "@/domain/progress";

const EMPTY = { subjectCount: 0, brandSavedAt: null, templateSavedAt: null, finalDeckCount: 0 };
const SAVED = "2026-10-01T10:00:00.000Z";
const TPL = { slides: 13, durationMinutes: 20 };
const FULL = { subjectCount: 9, brandSavedAt: SAVED, templateSavedAt: SAVED, finalDeckCount: 2, template: TPL };

function step(p: ProjectProgress, id: StepId) {
  const s = p.steps.find((x) => x.id === id);
  if (!s) throw new Error(`étape ${id} absente`);
  return s;
}
function tab(p: ProjectProgress, id: TemplateTabId) {
  const t = p.templateTabs.find((x) => x.id === id);
  if (!t) throw new Error(`onglet ${id} absent`);
  return t;
}

describe("computeProjectProgress — structure", () => {
  it("devrait renvoyer les 3 étapes Apparence, Trame, Jour J, indexées de 1 à 3", () => {
    const p = computeProjectProgress(EMPTY);
    expect(p.steps.map((s) => [s.id, s.index])).toEqual([
      ["appearance", 1],
      ["template", 2],
      ["day", 3],
    ]);
    expect(STEP_ORDER).toEqual(["appearance", "template", "day"]);
    expect(p.total).toBe(3);
  });

  it("devrait détailler la trame en deux onglets : diapos puis sujets", () => {
    expect(computeProjectProgress(EMPTY).templateTabs.map((t) => t.id)).toEqual(["slides", "subjects"]);
  });

  it("ne devrait plus porter de blocage ni de détail « Préparer »", () => {
    const p = computeProjectProgress(EMPTY);
    for (const s of p.steps) expect(s).not.toHaveProperty("blockedBy");
    expect(p).not.toHaveProperty("prepare");
  });

  it("devrait tout marquer à faire pour un projet neuf, l'étape suivante étant l'apparence", () => {
    const p = computeProjectProgress(EMPTY);
    expect(p.steps.every((s) => s.status === "todo")).toBe(true);
    expect(p).toMatchObject({ doneCount: 0, nextStep: "appearance" });
  });

  it("devrait tout marquer fait, sans étape suivante, pour un projet complet", () => {
    const p = computeProjectProgress(FULL);
    expect(p.steps.every((s) => s.status === "done")).toBe(true);
    expect(p).toMatchObject({ doneCount: 3, nextStep: null });
    expect(p.templateTabs.every((t) => t.status === "done")).toBe(true);
  });
});

describe("computeProjectProgress — apparence", () => {
  it("devrait être faite dès qu'elle a été enregistrée", () => {
    const p = computeProjectProgress({ ...EMPTY, brandSavedAt: SAVED });
    expect(step(p, "appearance")).toMatchObject({ status: "done", summary: "Personnalisée" });
  });

  it("devrait rester à faire, « Par défaut », tant qu'elle n'a jamais été enregistrée", () => {
    expect(step(computeProjectProgress(EMPTY), "appearance")).toMatchObject({ status: "todo", summary: "Par défaut" });
  });

  it("ne devrait pas dépendre des sujets", () => {
    expect(step(computeProjectProgress({ ...EMPTY, subjectCount: 4 }), "appearance").status).toBe("todo");
  });
});

describe("computeProjectProgress — trame", () => {
  it("devrait être faite dès qu'elle a été enregistrée, même sans sujet", () => {
    expect(step(computeProjectProgress({ ...EMPTY, templateSavedAt: SAVED }), "template").status).toBe("done");
  });

  it("ne devrait pas être faite par les seuls sujets", () => {
    expect(step(computeProjectProgress({ ...EMPTY, subjectCount: 3 }), "template").status).toBe("todo");
  });

  it.each([
    [{ templateSavedAt: SAVED, template: TPL }, "13 diapos · 20 min"],
    [{ template: TPL }, "Par défaut · 13 diapos · 20 min"],
    [{ templateSavedAt: SAVED, template: { slides: 1, durationMinutes: 5 } }, "1 diapo · 5 min"],
    [{ templateSavedAt: SAVED }, "Personnalisée"],
    [{}, "Par défaut"],
    [{ templateSavedAt: SAVED, template: TPL, subjectCount: 3 }, "13 diapos · 20 min · 3 sujets"],
    [{ template: TPL, subjectCount: 1 }, "Par défaut · 13 diapos · 20 min · 1 sujet"],
    [{ subjectCount: 2 }, "Par défaut · 2 sujets"],
  ])("résumé de la trame (%o) → %s", (over, summary) => {
    expect(step(computeProjectProgress({ ...EMPTY, ...over }), "template").summary).toBe(summary);
  });

  it("onglet diapos : détail si enregistrée, « Par défaut » sinon", () => {
    expect(tab(computeProjectProgress({ ...EMPTY, templateSavedAt: SAVED, template: TPL }), "slides")).toEqual({
      id: "slides",
      status: "done",
      summary: "13 diapos · 20 min",
    });
    expect(tab(computeProjectProgress({ ...EMPTY, templateSavedAt: SAVED }), "slides").summary).toBe("Personnalisée");
    expect(tab(computeProjectProgress({ ...EMPTY, template: TPL }), "slides")).toEqual({
      id: "slides",
      status: "default",
      summary: "Par défaut",
    });
  });

  it.each([
    [0, "optional", "Facultatif"],
    [1, "done", "1 sujet"],
    [3, "done", "3 sujets"],
  ])("onglet sujets : %i sujet(s) → %s, %s", (subjectCount, status, summary) => {
    expect(tab(computeProjectProgress({ ...EMPTY, subjectCount }), "subjects")).toEqual({ id: "subjects", status, summary });
  });
});

describe("computeProjectProgress — jour J", () => {
  it("devrait être fait dès 1 diaporama, sans sujet ni personnalisation", () => {
    expect(step(computeProjectProgress({ ...EMPTY, finalDeckCount: 1 }), "day").status).toBe("done");
    expect(step(computeProjectProgress(EMPTY), "day").status).toBe("todo");
  });

  it.each([
    [0, "Aucun diaporama"],
    [1, "1 diaporama"],
    [2, "2 diaporamas"],
  ])("résumé du jour J : %i → %s", (finalDeckCount, summary) => {
    expect(step(computeProjectProgress({ ...EMPTY, finalDeckCount }), "day").summary).toBe(summary);
  });
});

describe("computeProjectProgress — nextStep et doneCount", () => {
  it("devrait désigner la première étape non faite, même si une suivante est faite", () => {
    const p = computeProjectProgress({ ...EMPTY, brandSavedAt: SAVED, finalDeckCount: 1 });
    expect(p).toMatchObject({ nextStep: "template", doneCount: 2 });
  });

  it("devrait désigner le jour J quand apparence et trame sont enregistrées", () => {
    expect(computeProjectProgress({ ...FULL, finalDeckCount: 0 })).toMatchObject({ nextStep: "day", doneCount: 2 });
  });

  it("devrait désigner l'apparence même quand seul le jour J est fait", () => {
    expect(computeProjectProgress({ ...EMPTY, finalDeckCount: 3 })).toMatchObject({ nextStep: "appearance", doneCount: 1 });
  });
});

describe("computeProjectProgress — entrées hors bornes", () => {
  it("devrait traiter des compteurs négatifs ou NaN comme 0", () => {
    const p = computeProjectProgress({ ...EMPTY, subjectCount: -2, finalDeckCount: Number.NaN, template: { slides: -1, durationMinutes: Number.NaN } });
    expect(step(p, "template").summary).toBe("Par défaut · 0 diapo · 0 min");
    expect(tab(p, "subjects").summary).toBe("Facultatif");
    expect(step(p, "day")).toMatchObject({ status: "todo", summary: "Aucun diaporama" });
  });
});
