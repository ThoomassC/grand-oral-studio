import { LIMITS, type DeckSpec, type PromptTemplate, type Slide } from "./schemas";

/** Identifiant réservé de la diapo de couverture. */
export const COVER_SECTION_ID = "cover";

/**
 * Vérifie qu'un deck respecte la trame. Renvoie la liste des écarts (vide si
 * conforme), un message par problème, en citant le TITRE de la section (ligne de
 * trame) concernée (lisible par l'utilisateur ; l'id n'apparaît que pour une
 * section inconnue de la trame) :
 * - une seule couverture (layout "title"), en tête ;
 * - chaque section de la trame présente avec exactement `slides` diapos ;
 * - aucune section inconnue de la trame ;
 * - sections dans l'ordre de la trame.
 */
export function checkDeckAgainstTemplate(deck: DeckSpec, template: PromptTemplate): string[] {
  const issues: string[] = [];
  const slides = deck.slides;

  const first = slides[0];
  if (!first || first.layout !== "title") {
    issues.push("La couverture (diapo de layout « title ») doit être la première diapo.");
  }
  const coverCount = slides.filter((s) => s.layout === "title").length;
  if (coverCount > 1) {
    issues.push(`Le diaporama contient ${coverCount} diapos de couverture ; une seule est attendue.`);
  }

  const counts = new Map<string, number>();
  for (const slide of slides) {
    if (slide.sectionId === COVER_SECTION_ID) continue;
    counts.set(slide.sectionId, (counts.get(slide.sectionId) ?? 0) + 1);
  }

  const known = new Set(template.sections.map((s) => s.id));
  for (const section of template.sections) {
    const actual = counts.get(section.id) ?? 0;
    if (actual === 0) {
      issues.push(`La section « ${section.title} » est absente du diaporama.`);
    } else if (actual !== section.slides) {
      issues.push(`La section « ${section.title} » compte ${actual} diapo(s) au lieu de ${section.slides}.`);
    }
  }
  for (const id of counts.keys()) {
    if (!known.has(id)) issues.push(`La section « ${id} » n'existe pas dans la trame.`);
  }

  // Ordre : la suite des sections rencontrées doit suivre celle de la trame.
  const order = template.sections.map((s) => s.id);
  const seen = slides.map((s) => s.sectionId).filter((id) => id !== COVER_SECTION_ID && known.has(id));
  const sequence = seen.filter((id, i) => i === 0 || seen[i - 1] !== id);
  let cursor = -1;
  for (const id of sequence) {
    const pos = order.indexOf(id);
    if (pos <= cursor) {
      issues.push(`La section « ${template.sections[pos]?.title ?? id} » n'est pas à sa place dans l'ordre de la trame.`);
      break;
    }
    cursor = pos;
  }

  return issues;
}

/** Remplace une diapo par index, sans muter l'entrée. Lève RangeError hors bornes. */
export function replaceSlide(deck: DeckSpec, index: number, slide: Slide): DeckSpec {
  if (!Number.isInteger(index) || index < 0 || index >= deck.slides.length) {
    throw new RangeError(`Index de diapo hors bornes : ${index} (0..${deck.slides.length - 1}).`);
  }
  return {
    ...deck,
    slides: deck.slides.map((s, i) => (i === index ? { ...slide, bullets: [...slide.bullets] } : s)),
  };
}

/** Minutage de tête « [2:30–4:00] » d'une note d'orateur. */
export const NOTES_TIMING = /^\s*\[[^\]]*\]\s*/;
const TIMING = NOTES_TIMING;
/** En deçà, une note n'est pas un texte à dire (vide, ou consigne du type « Présentez le contexte. »). */
const THIN_NOTES_WORDS = 8;

function spokenWords(notes: string): number {
  return notes.replace(TIMING, "").split(/\s+/).filter(Boolean).length;
}

/** Note vide ou réduite à une consigne / un minutage : ce n'est pas un texte à dire. */
export function isThinNotes(notes: string): boolean {
  return spokenWords(notes) < THIN_NOTES_WORDS;
}

// ---------------------------------------------------------------------------
// Édition structurelle d'un diaporama (v1.2)
// ---------------------------------------------------------------------------

/** Bornes du nombre de diapos d'un diaporama (mêmes que DeckSpecSchema). */
export const MIN_DECK_SLIDES = LIMITS.minSlides;
export const MAX_DECK_SLIDES = LIMITS.maxSlides;

export type DeckEditErrorCode = "INDEX_OUT_OF_RANGE" | "TOO_MANY_SLIDES" | "TOO_FEW_SLIDES" | "COVER_LOCKED";

/**
 * Édition refusée. Sous-classe de RangeError (même style que `replaceSlide`) ;
 * `code` permet à la couche serveur de répondre en 4xx sans analyser le message.
 */
export class DeckEditError extends RangeError {
  readonly code: DeckEditErrorCode;

  constructor(code: DeckEditErrorCode, message: string) {
    super(message);
    this.name = "DeckEditError";
    this.code = code;
  }
}

function copySlide(slide: Slide): Slide {
  return { ...slide, bullets: [...slide.bullets] };
}

function assertIndex(index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new DeckEditError("INDEX_OUT_OF_RANGE", `Index de diapo hors bornes : ${index} (0..${max}).`);
  }
}

/** La couverture (layout « title » en tête) reste la première diapo : rien ne s'insère avant, elle ne bouge pas. */
function hasCover(deck: DeckSpec): boolean {
  return deck.slides[0]?.layout === "title";
}

function coverLocked(): DeckEditError {
  return new DeckEditError("COVER_LOCKED", "La couverture reste la première diapo : elle ne se déplace pas et ne se supprime pas.");
}

/**
 * Insère une diapo à `index` (0..longueur, longueur = en fin), sans muter l'entrée.
 * Refuse au-delà de MAX_DECK_SLIDES, et avant la couverture.
 */
export function insertSlide(deck: DeckSpec, index: number, slide: Slide): DeckSpec {
  assertIndex(index, deck.slides.length);
  if (deck.slides.length >= MAX_DECK_SLIDES) {
    throw new DeckEditError("TOO_MANY_SLIDES", `Un diaporama compte au plus ${MAX_DECK_SLIDES} diapos.`);
  }
  if (index === 0 && hasCover(deck)) throw coverLocked();
  const slides = deck.slides.map(copySlide);
  slides.splice(index, 0, copySlide(slide));
  return { ...deck, slides };
}

/** Retire la diapo `index`, sans muter l'entrée. Refuse sous MIN_DECK_SLIDES et pour la couverture. */
export function removeSlide(deck: DeckSpec, index: number): DeckSpec {
  assertIndex(index, deck.slides.length - 1);
  if (index === 0 && hasCover(deck)) throw coverLocked();
  if (deck.slides.length <= MIN_DECK_SLIDES) {
    throw new DeckEditError("TOO_FEW_SLIDES", `Un diaporama compte au moins ${MIN_DECK_SLIDES} diapos.`);
  }
  return { ...deck, slides: deck.slides.filter((_, i) => i !== index).map(copySlide) };
}

/** Déplace la diapo `from` à la position `to` (indices du deck d'origine), sans muter l'entrée. */
export function moveSlide(deck: DeckSpec, from: number, to: number): DeckSpec {
  const last = deck.slides.length - 1;
  assertIndex(from, last);
  assertIndex(to, last);
  if ((from === 0 || to === 0) && from !== to && hasCover(deck)) throw coverLocked();
  const slides = deck.slides.map(copySlide);
  const [moved] = slides.splice(from, 1);
  if (moved) slides.splice(to, 0, moved);
  return { ...deck, slides };
}

/** Copie profonde d'un diaporama : aucun tableau ni objet partagé avec l'original. */
export function duplicateDeckSpec(deck: DeckSpec): DeckSpec {
  return { ...deck, slides: deck.slides.map(copySlide) };
}
