import type { ProjectStep, StepId, TemplateTab } from "@/domain/progress";

/** Les 3 étapes d'un projet de test. */
export function makeSteps(doneIds: StepId[]): ProjectStep[] {
  const ids: StepId[] = ["appearance", "template", "day"];
  return ids.map((id, i) => ({
    id,
    index: (i + 1) as ProjectStep["index"],
    status: doneIds.includes(id) ? "done" : "todo",
    summary: `résumé ${id}`,
  }));
}

/** Les onglets de la trame : diapos par défaut ou personnalisées, 0 à n sujets. */
export function makeTemplateTabs({ slides = false, subjects = 0 } = {}): TemplateTab[] {
  return [
    { id: "slides", status: slides ? "done" : "default", summary: slides ? "13 diapos · 20 min" : "Par défaut" },
    {
      id: "subjects",
      status: subjects > 0 ? "done" : "optional",
      summary: subjects > 0 ? `${subjects} sujet${subjects > 1 ? "s" : ""}` : "Facultatif",
    },
  ];
}
