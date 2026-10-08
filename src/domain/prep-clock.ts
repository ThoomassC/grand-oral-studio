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

/** Seuils de référence (préparation de 90 min) : ce sont aussi les plafonds. */
const REHEARSE_FROM_MINUTES_MAX = 45;
const FINAL_FROM_MINUTES_MAX = 10;

/**
 * Seuils (minutes restantes) d'une préparation de `prepMinutes` : répéter à la
 * moitié du temps, dernières minutes au neuvième — 45 et 10 min pour 90 min,
 * bornés à ces valeurs pour une préparation plus longue, jamais sous 1 min.
 * Une préparation courte commence donc toujours par la génération.
 */
function thresholds(prepMinutes: number): { rehearse: number; final: number } {
  const prep = Number.isFinite(prepMinutes) && prepMinutes > 0 ? prepMinutes : DEFAULT_PREP_MINUTES;
  return {
    rehearse: Math.min(REHEARSE_FROM_MINUTES_MAX, Math.max(2, Math.round(prep / 2))),
    final: Math.min(FINAL_FROM_MINUTES_MAX, Math.max(1, Math.round(prep / 9))),
  };
}

/**
 * Jalons de la préparation selon le temps restant et la durée de la trame :
 * générer le diaporama tant qu'il reste plus que le seuil de répétition (45 min
 * pour 90 min), répéter jusqu'au seuil final (10 min pour 90 min), dernières
 * minutes ensuite, « over » à 0.
 */
export function milestones(remaining: number, prepMinutes: number = DEFAULT_PREP_MINUTES): Milestones {
  const ms = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  const { rehearse, final } = thresholds(prepMinutes);
  const items: readonly Omit<Milestone, "state">[] = [
    { id: "generate", label: "Diaporama à générer", fromMinutes: null },
    { id: "rehearse", label: `Reste ${rehearse} min : répétez`, fromMinutes: rehearse },
    { id: "final", label: "Dernières minutes", fromMinutes: final },
  ];
  const current: Milestones["current"] =
    ms === 0 ? "over" : ms <= final * MINUTE_MS ? "final" : ms <= rehearse * MINUTE_MS ? "rehearse" : "generate";
  const currentIndex = current === "over" ? items.length : items.findIndex((m) => m.id === current);
  return {
    current,
    items: items.map((m, i) => ({
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
