import { z } from "zod";
import type { PromptTemplate } from "./schemas";

/**
 * Chronomètre du temps de préparation du jour J : durée, décompte, jalons et
 * état persisté dans le navigateur. Fonctions pures : l'horloge est un paramètre.
 */

export const DEFAULT_PREP_MINUTES = 90;
/** Bornes de `PromptTemplate.prepMinutes` (champ optionnel, ajouté au schéma de la trame en v1.2). */
export const PREP_MINUTES_MIN = 10;
export const PREP_MINUTES_MAX = 240;
/** Au-delà, un départ enregistré est périmé (oubli d'une session précédente). */
export const MAX_PREP_STATE_AGE_MS = 6 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;

/**
 * Durée de préparation de la trame, en minutes : `prepMinutes` s'il est entier et
 * dans 10..240, sinon 90. Lecture tolérante : le champ peut manquer au type.
 */
export function prepMinutesOf(template: PromptTemplate | null | undefined): number {
  const value = (template as { prepMinutes?: unknown } | null | undefined)?.prepMinutes;
  return typeof value === "number" && Number.isInteger(value) && value >= PREP_MINUTES_MIN && value <= PREP_MINUTES_MAX
    ? value
    : DEFAULT_PREP_MINUTES;
}

function toMs(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value;
}

/** Temps restant en ms, borné à [0, minutes] (une horloge antérieure au départ ne rallonge rien). */
export function remainingMs(startedAt: number | Date, now: number | Date, minutes: number): number {
  const total = minutes * MINUTE_MS;
  const elapsed = Math.max(0, toMs(now) - toMs(startedAt));
  return Math.max(0, total - elapsed);
}

/**
 * Temps restant arrondi à la minute SUPÉRIEURE (« 1 min » jusqu'à la dernière
 * seconde) : « 1 h 12 », « 1 h », « 8 min », « 0 min ».
 */
export function formatRemaining(ms: number): string {
  const minutes = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / MINUTE_MS) : 0;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

export type MilestoneId = "generate" | "rehearse" | "final";
export type MilestoneState = "past" | "current" | "upcoming";

export interface Milestone {
  id: MilestoneId;
  label: string;
  /** Le jalon commence quand il reste au plus ce nombre de minutes (null : dès le départ). */
  fromMinutes: number | null;
  state: MilestoneState;
}

export interface Milestones {
  current: MilestoneId | "over";
  items: Milestone[];
}

const REHEARSE_FROM_MINUTES = 45;
const FINAL_FROM_MINUTES = 10;

const MILESTONES: readonly Omit<Milestone, "state">[] = [
  { id: "generate", label: "Diaporama à générer", fromMinutes: null },
  { id: "rehearse", label: "Reste 45 min : répétez", fromMinutes: REHEARSE_FROM_MINUTES },
  { id: "final", label: "Dernières minutes", fromMinutes: FINAL_FROM_MINUTES },
];

/**
 * Jalons de la préparation selon le temps restant : générer le diaporama tant
 * qu'il reste plus de 45 min, répéter de 45 à 10 min, dernières minutes sous
 * 10 min, « over » à 0.
 */
export function milestones(remaining: number): Milestones {
  const ms = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  const current: Milestones["current"] =
    ms === 0
      ? "over"
      : ms <= FINAL_FROM_MINUTES * MINUTE_MS
        ? "final"
        : ms <= REHEARSE_FROM_MINUTES * MINUTE_MS
          ? "rehearse"
          : "generate";
  const currentIndex = current === "over" ? MILESTONES.length : MILESTONES.findIndex((m) => m.id === current);
  return {
    current,
    items: MILESTONES.map((m, i) => ({
      ...m,
      state: i < currentIndex ? "past" : i === currentIndex ? "current" : "upcoming",
    })),
  };
}

/** Clé localStorage du chronomètre d'un projet. */
export function storageKey(programId: string): string {
  return `grand-oral-studio:prep:${programId}`;
}

/** État persisté (versionné) : instant de départ, en ms depuis l'époque. */
const PrepStateSchema = z.object({
  v: z.literal(1),
  startedAt: z.number().int().nonnegative(),
});

export interface PrepState {
  startedAt: number;
}

export function serializePrepState(state: PrepState): string {
  return JSON.stringify({ v: 1, startedAt: state.startedAt } satisfies z.infer<typeof PrepStateSchema>);
}

/**
 * Relit l'état persisté ; null s'il est absent, illisible, d'une autre version,
 * dans le futur, ou plus vieux que 6 h. Ne lève jamais.
 */
export function parsePrepState(raw: string | null, now: number): PrepState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = PrepStateSchema.safeParse(data);
  if (!parsed.success) return null;
  const { startedAt } = parsed.data;
  if (startedAt > now || now - startedAt > MAX_PREP_STATE_AGE_MS) return null;
  return { startedAt };
}
