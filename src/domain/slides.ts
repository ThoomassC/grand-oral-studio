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

/** Total de diapos produit par la trame : 1 couverture + somme des lignes. */
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
    "Vous pouvez enregistrer tel quel si vos consignes imposent ce rythme ; sinon, ajustez la durée ou le nombre de diapos par ligne."
  );
}

// ---------------------------------------------------------------------------
// Minutage de la trame
// ---------------------------------------------------------------------------

/** Intervalle en secondes depuis le début de l'oral. */
export interface TimeSpan {
  start: number;
  end: number;
}

export interface TemplateTimings {
  cover: TimeSpan;
  /** Une entrée par diapo hors couverture, dans l'ordre de la trame. */
  slides: TimeSpan[];
  /** Une entrée par ligne (section), dans l'ordre. */
  sections: { id: string; start: number; end: number }[];
}

/** La couverture est brève : 30 s au plus. */
const MAX_COVER_SECONDS = 30;

/**
 * Minutage de la trame. cover = min(30, total / nbDiapos). Les lignes avec `seconds` prennent leur durée
 * (répartie à parts égales entre leurs diapos) ; le temps restant (total − cover − Σ seconds, borné à 0)
 * est réparti à parts égales entre les DIAPOS des lignes sans durée. Sans aucune durée : strictement
 * identique au calcul v1.0.1 de prompts.ts (`templateLines`) et du moteur gratuit (`buildDeck`, free/outline.ts).
 */
export function templateTimings(template: PromptTemplate): TemplateTimings {
  const totalSeconds = template.durationMinutes * 60;
  const coverSeconds = Math.min(MAX_COVER_SECONDS, totalSeconds / totalSlides(template));
  const fixedSeconds = template.sections.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  const freeSlides = template.sections.reduce((sum, s) => sum + (s.seconds === undefined ? s.slides : 0), 0);
  const remaining = Math.max(0, totalSeconds - coverSeconds - fixedSeconds);
  const perFreeSlide = remaining / Math.max(1, freeSlides);

  const slides: TimeSpan[] = [];
  const sections: TemplateTimings["sections"] = [];
  let cursor = coverSeconds;
  for (const section of template.sections) {
    const perSlide = section.seconds === undefined ? perFreeSlide : section.seconds / section.slides;
    const start = cursor;
    for (let i = 0; i < section.slides; i += 1) {
      // Bornes calculées depuis le début de la ligne : pas d'erreur d'arrondi cumulée diapo après diapo.
      slides.push({ start: start + i * perSlide, end: start + (i + 1) * perSlide });
    }
    cursor = start + section.slides * perSlide;
    sections.push({ id: section.id, start, end: cursor });
  }
  return { cover: { start: 0, end: coverSeconds }, slides, sections };
}

/** 210 → "3:30" ; 30 → "0:30" ; 3600 → "60:00". Arrondi à la seconde, jamais négatif. */
export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Formes reconnues, sur le texte en minuscules et sans espaces. */
const DURATION_PATTERNS: readonly { pattern: RegExp; toSeconds: (m: RegExpMatchArray) => number }[] = [
  // 3:30
  { pattern: /^(\d{1,3}):([0-5]\d)$/, toSeconds: (m) => Number(m[1]) * 60 + Number(m[2]) },
  // 3'30, 3’30, 3'
  { pattern: /^(\d{1,3})['’]([0-5]\d)?$/, toSeconds: (m) => Number(m[1]) * 60 + Number(m[2] ?? 0) },
  // 3min, 3min30, 3min30s, 3minutes
  {
    pattern: /^(\d{1,3})(?:min|mn|minutes?)(?:([0-5]?\d)(?:s|sec|secondes?)?)?$/,
    toSeconds: (m) => Number(m[1]) * 60 + Number(m[2] ?? 0),
  },
  // 90s, 90sec, 90secondes
  { pattern: /^(\d{1,4})(?:s|sec|secondes?)$/, toSeconds: (m) => Number(m[1]) },
  // 1h05, 1h
  { pattern: /^(\d{1,2})h([0-5]\d)?$/, toSeconds: (m) => Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 },
];

/**
 * Durée saisie ou lue dans un tableau → secondes, ou null si illisible. Accepte : "3:30", "3 min",
 * "3 min 30", "3 min 30 s", "3'30", "3’30", "90 s", "90 sec", "1h05", "1 h 05" ; espaces et casse
 * indifférents ; "0:00" et valeurs négatives → null. Un nombre seul ("3") est ambigu → null.
 */
export function parseDurationText(text: string): number | null {
  const compact = text.toLowerCase().replace(/\s+/g, "");
  for (const { pattern, toSeconds } of DURATION_PATTERNS) {
    const match = compact.match(pattern);
    if (!match) continue;
    const seconds = toSeconds(match);
    return seconds > 0 ? seconds : null;
  }
  return null;
}
