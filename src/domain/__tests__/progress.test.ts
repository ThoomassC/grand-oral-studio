import { describe, expect, it } from "vitest";
import {
  computeProjectProgress,
  STEP_ORDER,
  type ProjectProgress,
  type StepId,
  type TemplateTabId,
} from "@/domain/progress";

const EMPTY = { subjectCount: 0, brandSavedAt: null, templateSavedAt: null, finalDeckCount: 0, rehearsalCount: 0 };
const SAVED = "2026-10-01T10:00:00.000Z";
const TPL = { slides: 13, durationMinutes: 20 };
const FULL = { subjectCount: 9, brandSavedAt: SAVED, templateSavedAt: SAVED, finalDeckCount: 2, rehearsalCount: 2, template: TPL };

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

  it("devrait marquer apparence et trame par défaut faites et seul le jour J à faire pour un projet neuf", () => {
    const p = computeProjectProgress(EMPTY);
    expect(p.steps.map((s) => [s.id, s.status])).toEqual([
      ["appearance", "done"],
      ["template", "done"],
      ["day", "todo"],
    ]);
    expect(p).toMatchObject({ doneCount: 2, nextStep: "day" });
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

  it("devrait être faite, « Par défaut », même jamais enregistrée : l'apparence par défaut est utilisable", () => {
    expect(step(computeProjectProgress(EMPTY), "appearance")).toMatchObject({ status: "done", summary: "Par défaut" });
  });

  it("ne devrait pas dépendre des sujets", () => {
    expect(step(computeProjectProgress({ ...EMPTY, subjectCount: 4 }), "appearance")).toMatchObject({ status: "done", summary: "Par défaut" });
  });
});

describe("computeProjectProgress — trame", () => {
  it("devrait être faite dès qu'elle a été enregistrée, même sans sujet", () => {
    expect(step(computeProjectProgress({ ...EMPTY, templateSavedAt: SAVED }), "template").status).toBe("done");
  });

  it("devrait être faite par défaut, sans enregistrement ni sujet : la trame par défaut est utilisable", () => {
    expect(step(computeProjectProgress(EMPTY), "template")).toMatchObject({ status: "done", summary: "Par défaut" });
    expect(step(computeProjectProgress({ ...EMPTY, template: TPL }), "template")).toMatchObject({
      status: "done",
      summary: "Par défaut · 13 diapos · 20 min",
    });
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

describe("computeProjectProgress — jour J (prêt : 2 diaporamas et 2 répétitions)", () => {
  it.each([
    [0, 0, "todo"],
    [1, 0, "todo"],
    [1, 5, "todo"],
    [2, 1, "todo"],
    [5, 0, "todo"],
    [2, 2, "done"],
    [3, 7, "done"],
  ])("%i diaporama(s) et %i répétition(s) → %s", (finalDeckCount, rehearsalCount, status) => {
    expect(step(computeProjectProgress({ ...EMPTY, finalDeckCount, rehearsalCount }), "day").status).toBe(status);
  });

  it("ne devrait plus être fait avec un seul diaporama (ancienne règle)", () => {
    expect(step(computeProjectProgress({ ...EMPTY, finalDeckCount: 1 }), "day").status).toBe("todo");
  });

  it.each([
    [0, 0, "Aucun diaporama"],
    [1, 0, "1 diaporama · aucune répétition"],
    [2, 1, "2 diaporamas · 1 répétition"],
    [2, 3, "2 diaporamas · 3 répétitions"],
  ])("résumé du jour J : %i diaporama(s), %i répétition(s) → %s", (finalDeckCount, rehearsalCount, summary) => {
    expect(step(computeProjectProgress({ ...EMPTY, finalDeckCount, rehearsalCount }), "day").summary).toBe(summary);
  });

  it("devrait exposer le nombre de répétitions (libellé « N répétitions faites »)", () => {
    expect(computeProjectProgress({ ...EMPTY, finalDeckCount: 2, rehearsalCount: 4 }).rehearsalCount).toBe(4);
    expect(computeProjectProgress({ ...EMPTY, rehearsalCount: -3 }).rehearsalCount).toBe(0);
  });
});

describe("computeProjectProgress — nextStep et doneCount", () => {
  it.each([
    ["projet neuf", EMPTY],
    ["apparence enregistrée", { ...EMPTY, brandSavedAt: SAVED }],
    ["apparence et trame enregistrées", { ...FULL, finalDeckCount: 0 }],
    ["diaporamas sans répétition", { ...FULL, rehearsalCount: 0 }],
    ["un seul diaporama", { ...FULL, finalDeckCount: 1 }],
  ])("devrait désigner le jour J, à 2/3, tant que le projet n'est pas prêt (%s)", (_, input) => {
    expect(computeProjectProgress(input)).toMatchObject({ nextStep: "day", doneCount: 2 });
  });

  it("devrait tout compter fait dès que le projet est prêt, même sans personnalisation", () => {
    expect(computeProjectProgress({ ...EMPTY, finalDeckCount: 2, rehearsalCount: 2 })).toMatchObject({ nextStep: null, doneCount: 3 });
  });
});

describe("computeProjectProgress — entrées hors bornes", () => {
  it("devrait traiter des compteurs négatifs ou NaN comme 0", () => {
    const p = computeProjectProgress({
      ...EMPTY,
      subjectCount: -2,
      finalDeckCount: Number.NaN,
      rehearsalCount: Number.POSITIVE_INFINITY,
      template: { slides: -1, durationMinutes: Number.NaN },
    });
    expect(step(p, "template").summary).toBe("Par défaut · 0 diapo · 0 min");
    expect(tab(p, "subjects").summary).toBe("Facultatif");
    expect(step(p, "day")).toMatchObject({ status: "todo", summary: "Aucun diaporama" });
    expect(p.rehearsalCount).toBe(0);
  });
});
