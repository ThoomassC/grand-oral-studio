/**
 * Progression d'un projet : un parcours en 3 étapes, calculé à partir de
 * compteurs et de dates d'enregistrement. Fonction pure (aucune base, aucun
 * réseau), partagée par le serveur et l'interface.
 *
 *   1. Apparence — toujours faite : par défaut ou personnalisée (enregistrée),
 *                  elle est utilisable ; le résumé dit laquelle.
 *   2. Trame     — toujours faite, par défaut ou personnalisée, pour la même
 *                  raison. Les sujets, facultatifs, en sont un onglet.
 *   3. Jour J    — fait quand le projet est « prêt » (cf. ./readiness.ts) : au
 *                  moins 2 diaporamas, entraînement compris, ET au moins 2
 *                  répétitions chronométrées. La seule étape « à faire ».
 *
 * Rien ne bloque : l'apparence et la trame par défaut sont utilisables, les
 * sujets sont facultatifs et le moteur « Sans IA » est toujours disponible.
 * Garder les réglages par défaut ne doit donc jamais paraître « à faire ».
 */

import { isExamReady } from "./readiness";

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
  /** Répétitions chronométrées de l'utilisateur sur les diaporamas actifs du projet. */
  rehearsalCount: number;
  /** Détail de l'étape « Trame » : ses diapos et ses sujets. */
  templateTabs: TemplateTab[];
  doneCount: number;
  total: 3;
  /** Première étape non faite dans l'ordre (en pratique le jour J) ; null si tout est fait. */
  nextStep: StepId | null;
}

/** Résumé compact pour les listes (sans le détail des étapes). */
export interface ProjectProgressSummary {
  doneCount: number;
  total: 3;
  nextStep: StepId | null;
  rehearsalCount: number;
}

export interface ProjectProgressInput {
  subjectCount: number;
  /** Date ISO du dernier enregistrement de l'apparence ; null = jamais (apparence par défaut). */
  brandSavedAt: string | null;
  templateSavedAt: string | null;
  /** Diaporamas actifs du projet (jour J et entraînement), hors anciens squelettes. */
  finalDeckCount: number;
  /** Répétitions de l'utilisateur sur ces diaporamas (chacun ne compte que les siennes). */
  rehearsalCount: number;
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

/** « Aucun diaporama », sinon « 2 diaporamas · 1 répétition ». */
function daySummary(decks: number, rehearsals: number): string {
  if (decks === 0) return "Aucun diaporama";
  const done = rehearsals > 0 ? plural(rehearsals, "répétition") : "aucune répétition";
  return `${plural(decks, "diaporama")} · ${done}`;
}

function templateSummary(saved: boolean, detail: string | null, subjects: number): string {
  const base = detail ? (saved ? detail : `${DEFAULT} · ${detail}`) : saved ? CUSTOM : DEFAULT;
  return subjects > 0 ? `${base} · ${plural(subjects, "sujet")}` : base;
}

export function computeProjectProgress(input: ProjectProgressInput): ProjectProgress {
  const subjects = count(input.subjectCount);
  const finals = count(input.finalDeckCount);
  const rehearsals = count(input.rehearsalCount);
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
    { id: "appearance", index: 1, status: "done", summary: brandSaved ? CUSTOM : DEFAULT },
    {
      id: "template",
      index: 2,
      status: "done",
      summary: templateSummary(templateSaved, detail, subjects),
    },
    {
      id: "day",
      index: 3,
      status: isExamReady({ decks: finals, rehearsals }) ? "done" : "todo",
      summary: daySummary(finals, rehearsals),
    },
  ];

  const doneCount = steps.filter((s) => s.status === "done").length;
  return {
    steps,
    rehearsalCount: rehearsals,
    templateTabs,
    doneCount,
    total: 3,
    nextStep: steps.find((s) => s.status === "todo")?.id ?? null,
  };
}
