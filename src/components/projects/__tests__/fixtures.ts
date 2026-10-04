import type { PrepareItem, ProjectStep, StepId } from "@/domain/progress";

/** Les 3 étapes d'un projet de test. */
export function makeSteps(doneIds: StepId[], blocked: Partial<Record<StepId, StepId>> = {}): ProjectStep[] {
  const ids: StepId[] = ["prepare", "skeletons", "day"];
  return ids.map((id, i) => ({
    id,
    index: (i + 1) as ProjectStep["index"],
    status: doneIds.includes(id) ? "done" : "todo",
    blockedBy: blocked[id] ?? null,
    summary: `résumé ${id}`,
  }));
}

/** Les choix de Préparer : thèmes faits ou non, charte et gabarit par défaut ou personnalisés. */
export function makePrepare({ themes = false, brand = false, template = false } = {}): PrepareItem[] {
  return [
    { id: "themes", required: true, status: themes ? "done" : "todo", summary: themes ? "2 thèmes" : "Aucun thème" },
    { id: "brand", required: false, status: brand ? "done" : "default", summary: brand ? "Charte enregistrée" : "Charte par défaut" },
    { id: "template", required: false, status: template ? "done" : "default", summary: "13 diapos · 20 min" },
  ];
}
