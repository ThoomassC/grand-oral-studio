import { describe, expect, it } from "vitest";
import { examChecklist, type ExamChecklistInput } from "@/domain/exam-checklist";

const ready: ExamChecklistInput = {
  writerReady: true,
  writerLabel: "Claude",
  templateSaved: true,
  exportTried: true,
  practiceDecks: 2,
  rehearsals: 3,
};

describe("examChecklist", () => {
  it("devrait lister les cinq vérifications dans l'ordre", () => {
    expect(examChecklist(ready).map((i) => i.id)).toEqual(["writer", "template", "export", "practice", "rehearsals"]);
  });

  it("devrait tout cocher, sans conseil, quand tout est prêt", () => {
    const items = examChecklist(ready);
    expect(items.every((i) => i.done)).toBe(true);
    expect(items.every((i) => i.hint === null)).toBe(true);
  });

  it("devrait nommer le rédacteur dans le libellé", () => {
    expect(examChecklist(ready)[0]?.label).toBe("Rédaction : Claude");
  });

  it("devrait donner un conseil pour chaque point non fait", () => {
    const items = examChecklist({ ...ready, writerReady: false, templateSaved: false, exportTried: false, practiceDecks: 0, rehearsals: 0 });
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.every((i) => typeof i.hint === "string" && i.hint.length > 0)).toBe(true);
  });

  it("devrait indiquer où en est l'entraînement", () => {
    const items = examChecklist({ ...ready, practiceDecks: 1, rehearsals: 1 });
    expect(items.find((i) => i.id === "practice")?.hint).toContain("1 sur 2");
    expect(items.find((i) => i.id === "rehearsals")?.hint).toContain("1 sur 2");
  });

  it.each([Number.NaN, -3, Number.POSITIVE_INFINITY])("devrait traiter un compteur invalide (%s) comme 0", (n) => {
    const items = examChecklist({ ...ready, practiceDecks: n });
    expect(items.find((i) => i.id === "practice")).toMatchObject({ done: false });
    expect(items.find((i) => i.id === "practice")?.hint).toContain("0 sur 2");
  });
});
