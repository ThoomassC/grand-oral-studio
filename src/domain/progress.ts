/**
 * Progression d'un projet : un parcours en 3 étapes, calculé à partir de
 * compteurs et de dates d'enregistrement. Fonction pure (aucune base, aucun
 * réseau), partagée par le serveur et l'interface.
 *
 *   1. Apparence — faite dès qu'elle a été enregistrée (sinon : apparence par défaut)
 *   2. Trame     — faite dès qu'elle a été enregistrée (sinon : trame par défaut).
 *                  Les sujets, facultatifs, en sont un onglet.
 *   3. Jour J    — fait dès 1 diaporama final
 *
 * Rien ne bloque : l'apparence et la trame par défaut sont utilisables, les
 * sujets sont facultatifs et le moteur « Sans IA » est toujours disponible.
 */

export type StepId = "appearance" | "template" | "day";
export type StepStatus = "done" | "todo";
export type TemplateTabId = "slides" | "subjects";

export interface TemplateTab {
  id: TemplateTabId;
  /** "default" : diapos jamais personnalisées ; "optional" : aucun sujet (facultatifs). */
  status: "done" | "default" | "optional";
  summary: string;
}

export interface ProjectStep {
  id: StepId;
  index: 1 | 2 | 3;
  status: StepStatus;
  /** Résumé court, en français, affichable tel quel. */
  summary: string;
}

export interface ProjectProgress {
  steps: ProjectStep[];
  /** Détail de l'étape « Trame » : ses diapos et ses sujets. */
  templateTabs: TemplateTab[];
  doneCount: number;
  total: 3;
  /** Première étape non faite dans l'ordre ; null si tout est fait. */
  nextStep: StepId | null;
}

/** Résumé compact pour les listes (sans le détail des étapes). */
export interface ProjectProgressSummary {
  doneCount: number;
  total: 3;
  nextStep: StepId | null;
}

export interface ProjectProgressInput {
  subjectCount: number;
  /** Date ISO du dernier enregistrement de l'apparence ; null = jamais (apparence par défaut). */
  brandSavedAt: string | null;
  templateSavedAt: string | null;
  finalDeckCount: number;
  /** Détail de la trame pour le résumé (« 13 diapos · 20 min ») ; facultatif (absent dans la liste des projets). */
  template?: { slides: number; durationMinutes: number };
}

export const STEP_ORDER: readonly StepId[] = ["appearance", "template", "day"];

const CUSTOM = "Personnalisée";
const DEFAULT = "Par défaut";

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

/** « 13 diapos · 20 min » ; null sans détail fourni (liste des projets). */
function slidesDetail(template: ProjectProgressInput["template"]): string | null {
  if (!template) return null;
  return `${plural(count(template.slides), "diapo")} · ${count(template.durationMinutes)} min`;
}

function templateSummary(saved: boolean, detail: string | null, subjects: number): string {
  const base = detail ? (saved ? detail : `${DEFAULT} · ${detail}`) : saved ? CUSTOM : DEFAULT;
  return subjects > 0 ? `${base} · ${plural(subjects, "sujet")}` : base;
}

export function computeProjectProgress(input: ProjectProgressInput): ProjectProgress {
  const subjects = count(input.subjectCount);
  const finals = count(input.finalDeckCount);
  const brandSaved = input.brandSavedAt !== null;
  const templateSaved = input.templateSavedAt !== null;
  const detail = slidesDetail(input.template);

  const templateTabs: TemplateTab[] = [
    {
      id: "slides",
      status: templateSaved ? "done" : "default",
      summary: templateSaved ? (detail ?? CUSTOM) : DEFAULT,
    },
    {
      id: "subjects",
      status: subjects > 0 ? "done" : "optional",
      summary: subjects > 0 ? plural(subjects, "sujet") : "Facultatif",
    },
  ];

  const steps: ProjectStep[] = [
    { id: "appearance", index: 1, status: brandSaved ? "done" : "todo", summary: brandSaved ? CUSTOM : DEFAULT },
    {
      id: "template",
      index: 2,
      status: templateSaved ? "done" : "todo",
      summary: templateSummary(templateSaved, detail, subjects),
    },
    {
      id: "day",
      index: 3,
      status: finals >= 1 ? "done" : "todo",
      summary: finals > 0 ? plural(finals, "diaporama") : "Aucun diaporama",
    },
  ];

  const doneCount = steps.filter((s) => s.status === "done").length;
  return { steps, templateTabs, doneCount, total: 3, nextStep: steps.find((s) => s.status === "todo")?.id ?? null };
}
