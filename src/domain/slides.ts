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
