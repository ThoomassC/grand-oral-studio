import { z } from "zod";
import { COVER_SECTION_ID } from "./deck";
import { LIMITS, type DeckSpec, type PromptTemplate } from "./schemas";
import { templateTimings } from "./slides";

/**
 * Répétition chronométrée d'un diaporama : minutage prévu par diapo, bilan
 * d'une répétition et saisie validée. Fonctions pures (ni base, ni horloge).
 */

/** Durée maximale d'une répétition, en secondes (2 h). Alignée sur le CHECK de `Rehearsal.totalSeconds`. */
export const MAX_REHEARSAL_SECONDS = 7200;

const seconds = (label: string) =>
  z
    .number(`Indiquez ${label}.`)
    .int(`${label[0]!.toUpperCase()}${label.slice(1)} doit être un nombre entier de secondes.`);

/**
 * Saisie d'une répétition : durée totale (1 s à 2 h) et temps passé sur chaque
 * diapo (entiers ≥ 0, 2 à 60 valeurs). La somme des diapos ne dépasse pas la
 * durée totale, à une seconde d'arrondi près par diapo.
 */
export const RehearsalInputSchema = z
  .object({
    totalSeconds: seconds("la durée de la répétition")
      .min(1, "La répétition dure au moins 1 seconde.")
      .max(MAX_REHEARSAL_SECONDS, "La répétition dure au plus 2 heures."),
    perSlide: z
      .array(
        seconds("le temps de la diapo")
          .min(0, "Le temps d'une diapo ne peut pas être négatif.")
          .max(MAX_REHEARSAL_SECONDS, "Le temps d'une diapo ne dépasse pas 2 heures."),
      )
      .min(LIMITS.minSlides, `Une répétition porte sur au moins ${LIMITS.minSlides} diapos.`)
      .max(LIMITS.maxSlides, `Une répétition porte sur au plus ${LIMITS.maxSlides} diapos.`),
  })
  .refine((r) => r.perSlide.reduce((a, b) => a + b, 0) <= r.totalSeconds + r.perSlide.length, {
    message: "Le temps des diapos dépasse la durée de la répétition.",
    path: ["perSlide"],
  });
export type RehearsalInput = z.infer<typeof RehearsalInputSchema>;

/** Même schéma, avec autant de temps que de diapos dans le diaporama répété. */
export function rehearsalInputSchema(slideCount: number) {
  return RehearsalInputSchema.refine((r) => r.perSlide.length === slideCount, {
    message: `La répétition doit compter un temps par diapo (${slideCount}).`,
    path: ["perSlide"],
  });
}

// ---------------------------------------------------------------------------
// Minutage prévu
// ---------------------------------------------------------------------------

/** Repère de tête « [2:30–4:00] » (tiret, demi-cadratin ou cadratin), en minutes:secondes. */
const NOTES_SPAN = /^\s*\[\s*(\d{1,3}):([0-5]\d)\s*[-–—]\s*(\d{1,3}):([0-5]\d)\s*\]/;

/** Durée en secondes du repère de tête des notes ; null s'il est absent ou incohérent (fin ≤ début). */
export function notesSpanSeconds(notes: string): number | null {
  const m = notes.match(NOTES_SPAN);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return end > start ? end - start : null;
}

/**
 * Arrondi cumulatif : chaque diapo reçoit round(fin) − round(début). Les valeurs
 * sont entières et leur somme vaut l'arrondi du total, sans dérive.
 */
function roundCumulative(values: readonly number[]): number[] {
  let cumulative = 0;
  return values.map((value) => {
    const start = Math.round(cumulative);
    cumulative += value;
    return Math.round(cumulative) - start;
  });
}

/**
 * Minutage prévu de chaque diapo, en secondes entières. Règle, diapo par diapo :
 *  1. repère « [m:ss–m:ss] » en tête des notes (celui que l'IA et le moteur sans IA
 *     écrivent) → sa durée, s'il est cohérent ;
 *  2. sinon, diapo d'une ligne de la trame (sectionId connu, ou « cover ») → la durée
 *     de cette ligne selon `templateTimings`, partagée à parts égales entre TOUTES
 *     les diapos du deck qui portent cette ligne (une diapo ajoutée ou retirée
 *     redistribue le temps de sa ligne, sans toucher aux autres) ;
 *  3. sinon (diapo hors trame) → part égale du temps de l'oral non encore attribué
 *     (durée − somme des cas 1 et 2, bornée à 0). Sans aucun repère ni ligne
 *     reconnue, cela revient à répartir la durée de l'oral également.
 * Les valeurs sont arrondies de façon cumulative (somme sans dérive).
 */
export function plannedSecondsPerSlide(spec: DeckSpec, template: PromptTemplate): number[] {
  const total = template.durationMinutes * 60;
  const timings = templateTimings(template);
  const sectionSeconds = new Map<string, number>([[COVER_SECTION_ID, timings.cover.end - timings.cover.start]]);
  for (const s of timings.sections) sectionSeconds.set(s.id, s.end - s.start);

  const perSection = new Map<string, number>();
  for (const slide of spec.slides) perSection.set(slide.sectionId, (perSection.get(slide.sectionId) ?? 0) + 1);

  const known: (number | null)[] = spec.slides.map((slide) => {
    const fromNotes = notesSpanSeconds(slide.notes);
    if (fromNotes !== null) return fromNotes;
    const section = sectionSeconds.get(slide.sectionId);
    return section === undefined ? null : section / (perSection.get(slide.sectionId) ?? 1);
  });

  const unknownCount = known.filter((v) => v === null).length;
  const assigned = known.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const share = unknownCount === 0 ? 0 : Math.max(0, total - assigned) / unknownCount;
  return roundCumulative(known.map((v) => v ?? share));
}

// ---------------------------------------------------------------------------
// Bilan d'une répétition
// ---------------------------------------------------------------------------

export interface SlideDelta {
  index: number;
  /** Réel − prévu, en secondes (positif = dépassement). */
  delta: number;
}

export interface RehearsalSummary {
  totalSeconds: number;
  plannedTotal: number;
  /** totalSeconds − plannedTotal. */
  totalDelta: number;
  deltas: SlideDelta[];
  /** Diapos dépassant la tolérance, du plus fort dépassement au plus faible. */
  overruns: SlideDelta[];
}

/** Tolérance d'un dépassement : 10 s, ou 20 % du temps prévu si c'est plus. */
const OVERRUN_MIN_SECONDS = 10;
const OVERRUN_RATIO = 0.2;

/** Compare une répétition (`actual`) au minutage prévu (`planned`), diapo par diapo. Lève RangeError si les longueurs diffèrent. */
export function summarizeRehearsal(planned: readonly number[], actual: readonly number[]): RehearsalSummary {
  if (planned.length !== actual.length) {
    throw new RangeError(`Répétition incohérente : ${actual.length} temps pour ${planned.length} diapos.`);
  }
  const deltas = actual.map((value, index) => ({ index, delta: value - (planned[index] ?? 0) }));
  const overruns = deltas
    .filter(({ index, delta }) => delta > Math.max(OVERRUN_MIN_SECONDS, (planned[index] ?? 0) * OVERRUN_RATIO))
    .sort((a, b) => b.delta - a.delta || a.index - b.index);
  const totalSeconds = actual.reduce((a, b) => a + b, 0);
  const plannedTotal = planned.reduce((a, b) => a + b, 0);
  return { totalSeconds, plannedTotal, totalDelta: totalSeconds - plannedTotal, deltas, overruns };
}

/** Écart signé, arrondi à la seconde : « +1 min 10 », « −20 s », « +2 min », « 0 s ». Signe moins typographique (U+2212). */
export function formatDelta(sec: number): string {
  const rounded = Number.isFinite(sec) ? Math.round(sec) : 0;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  const abs = Math.abs(rounded);
  if (abs < 60) return `${sign}${abs} s`;
  const minutes = Math.floor(abs / 60);
  const rest = abs % 60;
  return rest === 0 ? `${sign}${minutes} min` : `${sign}${minutes} min ${String(rest).padStart(2, "0")}`;
}
