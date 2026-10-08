import { describe, expect, it } from "vitest";
import { examChecklist, type ExamChecklistInput } from "@/domain/exam-checklist";

const ready: ExamChecklistInput = {
  writerReady: true,
  writerLabel: "Claude",
  templateSaved: true,
  exportTried: true,
  decks: 2,
  rehearsals: 3,
};

describe("examChecklist", () => {
  it("devrait lister les cinq vérifications dans l'ordre", () => {
    expect(examChecklist(ready).map((i) => i.id)).toEqual(["writer", "template", "export", "decks", "rehearsals"]);
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
    const items = examChecklist({ ...ready, writerReady: false, templateSaved: false, exportTried: false, decks: 0, rehearsals: 0 });
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.every((i) => typeof i.hint === "string" && i.hint.length > 0)).toBe(true);
  });

  it("devrait indiquer où en est l'entraînement", () => {
    const items = examChecklist({ ...ready, decks: 1, rehearsals: 1 });
    expect(items.find((i) => i.id === "decks")?.hint).toContain("1 sur 2");
    expect(items.find((i) => i.id === "rehearsals")?.hint).toContain("1 sur 2");
  });

  it("devrait compter tous les diaporamas, entraînement et jour J confondus, comme la règle « prêt pour le jour J »", () => {
    const item = examChecklist({ ...ready, decks: 2 }).find((i) => i.id === "decks");
    expect(item).toMatchObject({ done: true, label: "2 diaporamas (entraînement ou jour J)", hint: null });
    expect(examChecklist({ ...ready, decks: 1 }).find((i) => i.id === "decks")?.hint).toBe(
      "Générez un diaporama, d'entraînement ou du jour J (1 sur 2).",
    );
  });

  it.each([Number.NaN, -3, Number.POSITIVE_INFINITY])("devrait traiter un compteur invalide (%s) comme 0", (n) => {
    const items = examChecklist({ ...ready, decks: n });
    expect(items.find((i) => i.id === "decks")).toMatchObject({ done: false });
    expect(items.find((i) => i.id === "decks")?.hint).toContain("0 sur 2");
  });
});
