import type { PromptTemplate } from "./schemas";

/** Minutes d'oral par diapo pour le conseil de dimensionnement. */
const MINUTES_PER_SLIDE = 1.5;
const MIN_SLIDES = 5;
const MAX_SLIDES = 30;

/** Nombre de diapos conseillé pour une durée d'oral (≈ 1 diapo / 1,5 min, borné 5..30). */
export function suggestSlideCount(durationMinutes: number): number {
  const raw = Math.round(durationMinutes / MINUTES_PER_SLIDE);
  return Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, raw));
}

/** Total de diapos produit par le gabarit : 1 couverture + somme des sections. */
export function totalSlides(template: PromptTemplate): number {
  return 1 + template.sections.reduce((sum, section) => sum + section.slides, 0);
}

/** Écart (en proportion) au-delà duquel le nombre de diapos est signalé. */
const BUDGET_TOLERANCE = 0.3;

function pace(seconds: number): string {
  if (seconds < 90) return `~${Math.round(seconds)} s par diapo`;
  const halfMinutes = Math.round(seconds / 30) / 2;
  return `~${String(halfMinutes).replace(".", ",")} min par diapo`;
}

/**
 * Avertissement explicite quand le total s'écarte de plus de 30 % du nombre
 * conseillé : rythme réel, repère, écart en %, et le choix laissé à
 * l'utilisateur (enregistrer quand même si ses consignes imposent ce rythme).
 * Null sous la tolérance.
 */
export function slideBudgetWarning(total: number, durationMinutes: number): string | null {
  if (!Number.isFinite(total) || !Number.isFinite(durationMinutes) || total <= 0 || durationMinutes <= 0) return null;
  const suggested = suggestSlideCount(durationMinutes);
  const gap = (total - suggested) / suggested;
  if (Math.abs(gap) <= BUDGET_TOLERANCE) return null;
  const percent = `${gap > 0 ? "+" : ""}${Math.round(gap * 100)} %`;
  const verdict = gap > 0 ? "Beaucoup de diapos pour la durée" : "Peu de diapos pour la durée";
  return (
    `${verdict} : ${total} diapos pour ${durationMinutes} min, soit ${pace((durationMinutes * 60) / total)} ` +
    `(repère conseillé : ${suggested} diapos, ~1 min 30 chacune ; écart ${percent}). ` +
    "Vous pouvez enregistrer tel quel si vos consignes imposent ce rythme ; sinon, ajustez la durée ou le nombre de diapos par section."
  );
}
