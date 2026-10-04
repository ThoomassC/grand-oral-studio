/**
 * Progression d'un projet : un parcours en 3 étapes, calculé à partir de
 * compteurs et de dates d'enregistrement. Fonction pure (aucune base, aucun
 * réseau), partagée par le serveur et l'interface.
 *
 *   1. Préparer   — faite dès 1 thème. La charte et le gabarit sont facultatifs :
 *                   leurs valeurs par défaut sont utilisables, ils ne bloquent jamais.
 *   2. Squelettes — faite quand chaque thème a son squelette (et qu'il y a des thèmes)
 *   3. Jour J     — faite dès 1 diaporama final
 *
 * Squelettes et jour J sont bloqués par la préparation tant qu'il n'y a aucun thème.
 */

export type StepId = "prepare" | "skeletons" | "day";
export type StepStatus = "done" | "todo";
export type PrepareItemId = "themes" | "brand" | "template";

export interface PrepareItem {
  id: PrepareItemId;
  /** Seuls les thèmes sont requis pour avancer. */
  required: boolean;
  /** "default" : jamais personnalisé, valeurs par défaut utilisables (charte, gabarit). */
  status: "done" | "todo" | "default";
  summary: string;
}

export interface ProjectStep {
  id: StepId;
  index: 1 | 2 | 3;
  status: StepStatus;
  /** Étape à faire d'abord pour pouvoir avancer sur celle-ci ; null si rien ne bloque. */
  blockedBy: StepId | null;
  /** Résumé court, en français, affichable tel quel. */
  summary: string;
}

export interface ProjectProgress {
  steps: ProjectStep[];
  /** Détail de l'étape « Préparer » : thèmes, charte, gabarit. */
  prepare: PrepareItem[];
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
  themeCount: number;
  /** Date ISO du dernier enregistrement de la charte ; null = jamais (charte par défaut). */
  brandSavedAt: string | null;
  templateSavedAt: string | null;
  skeletonCount: number;
  finalDeckCount: number;
  /** Détail du gabarit pour le résumé (« 13 diapos · 20 min ») ; facultatif (absent dans la liste des projets). */
  template?: { slides: number; durationMinutes: number };
}

export const STEP_ORDER: readonly StepId[] = ["prepare", "skeletons", "day"];

const NO_THEME_HINT = "Ajoutez d'abord des thèmes";

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n > 1 ? pluralForm : singular;
}

function prepareSummary(themes: number, brandSaved: boolean, templateSaved: boolean): string {
  if (themes === 0) return "Aucun thème";
  const look =
    brandSaved && templateSaved
      ? "charte et gabarit personnalisés"
      : brandSaved
        ? "charte personnalisée"
        : templateSaved
          ? "gabarit personnalisé"
          : "charte et gabarit par défaut";
  return `${themes} ${plural(themes, "thème")} · ${look}`;
}

function templateSummary(saved: boolean, template: ProjectProgressInput["template"]): string {
  if (!template) return saved ? "Gabarit personnalisé" : "Gabarit par défaut";
  const slides = count(template.slides);
  const detail = `${slides} ${plural(slides, "diapo")} · ${count(template.durationMinutes)} min`;
  return saved ? detail : `Gabarit par défaut · ${detail}`;
}

export function computeProjectProgress(input: ProjectProgressInput): ProjectProgress {
  const themes = count(input.themeCount);
  const skeletons = Math.min(count(input.skeletonCount), themes);
  const finals = count(input.finalDeckCount);
  const brandSaved = input.brandSavedAt !== null;
  const templateSaved = input.templateSavedAt !== null;
  const blockedByPrepare: StepId | null = themes === 0 ? "prepare" : null;

  const prepare: PrepareItem[] = [
    {
      id: "themes",
      required: true,
      status: themes >= 1 ? "done" : "todo",
      summary: themes === 0 ? "Aucun thème" : `${themes} ${plural(themes, "thème")}`,
    },
    {
      id: "brand",
      required: false,
      status: brandSaved ? "done" : "default",
      summary: brandSaved ? "Charte personnalisée" : "Charte par défaut",
    },
    {
      id: "template",
      required: false,
      status: templateSaved ? "done" : "default",
      summary: templateSummary(templateSaved, input.template),
    },
  ];

  const steps: ProjectStep[] = [
    {
      id: "prepare",
      index: 1,
      status: themes >= 1 ? "done" : "todo",
      blockedBy: null,
      summary: prepareSummary(themes, brandSaved, templateSaved),
    },
    {
      id: "skeletons",
      index: 2,
      status: themes > 0 && skeletons >= themes ? "done" : "todo",
      blockedBy: blockedByPrepare,
      summary: themes === 0 ? NO_THEME_HINT : `${skeletons}/${themes} ${plural(themes, "squelette")}`,
    },
    {
      id: "day",
      index: 3,
      status: finals >= 1 ? "done" : "todo",
      blockedBy: blockedByPrepare,
      summary: finals > 0 ? `${finals} ${plural(finals, "diaporama")}` : "Aucun diaporama",
    },
  ];

  const doneCount = steps.filter((s) => s.status === "done").length;
  return { steps, prepare, doneCount, total: 3, nextStep: steps.find((s) => s.status === "todo")?.id ?? null };
}
