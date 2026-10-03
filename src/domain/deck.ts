import { LIMITS, type DeckSpec, type PromptTemplate, type Slide } from "./schemas";

/** Identifiant réservé de la diapo de couverture. */
export const COVER_SECTION_ID = "cover";

/**
 * Vérifie qu'un deck respecte le gabarit. Renvoie la liste des écarts (vide si
 * conforme), un message par problème, en citant le TITRE de la section concernée
 * (lisible par l'utilisateur ; l'id n'apparaît que pour une section inconnue du gabarit) :
 * - une seule couverture (layout "title"), en tête ;
 * - chaque section du gabarit présente avec exactement `slides` diapos ;
 * - aucune section inconnue du gabarit ;
 * - sections dans l'ordre du gabarit.
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
    issues.push(`Le deck contient ${coverCount} diapos de couverture ; une seule est attendue.`);
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
      issues.push(`La section « ${section.title} » est absente du deck.`);
    } else if (actual !== section.slides) {
      issues.push(`La section « ${section.title} » compte ${actual} diapo(s) au lieu de ${section.slides}.`);
    }
  }
  for (const id of counts.keys()) {
    if (!known.has(id)) issues.push(`La section « ${id} » n'existe pas dans le gabarit.`);
  }

  // Ordre : la suite des sections rencontrées doit suivre celle du gabarit.
  const order = template.sections.map((s) => s.id);
  const seen = slides.map((s) => s.sectionId).filter((id) => id !== COVER_SECTION_ID && known.has(id));
  const sequence = seen.filter((id, i) => i === 0 || seen[i - 1] !== id);
  let cursor = -1;
  for (const id of sequence) {
    const pos = order.indexOf(id);
    if (pos <= cursor) {
      issues.push(`La section « ${template.sections[pos]?.title ?? id} » n'est pas à sa place dans l'ordre du gabarit.`);
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

/** Coupe un texte à `max` caractères, sur une fin de mot, avec une ellipse si coupé. */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Diapos d'un deck regroupées par section, dans l'ordre (index global conservé). */
function slidesBySection(slides: readonly Slide[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  slides.forEach((slide, i) => {
    const group = groups.get(slide.sectionId);
    if (group) group.push(i);
    else groups.set(slide.sectionId, [i]);
  });
  return groups;
}

export type CompletedNotes = {
  deck: DeckSpec;
  /** Numéros (1 = couverture) des diapos dont la note a été reprise du squelette. */
  filled: number[];
  /** Sections laissées telles quelles car leur nombre de diapos diffère du squelette. */
  skippedSections: string[];
};

/**
 * Filet de sécurité du deck final produit par l'IA : une note d'orateur vide ou
 * réduite à une consigne est remplacée par la note rédigée de la diapo de même
 * rang dans la même section du squelette, en gardant le minutage du deck.
 *
 * L'alignement se fait par rang au sein de chaque section : une diapo omise ou
 * ajoutée par l'IA ailleurs ne décale rien. Une section dont le nombre de diapos
 * diffère entre deck et squelette n'est pas complétée (impossible de savoir quelle
 * diapo correspond à quoi) et est signalée dans `skippedSections` quand elle avait
 * des notes trop courtes. La note produite ne dépasse jamais `LIMITS.notes`.
 */
export function completeThinNotes(deck: DeckSpec, skeleton: DeckSpec | null): CompletedNotes {
  if (!skeleton) return { deck, filled: [], skippedSections: [] };
  const skeletonGroups = slidesBySection(skeleton.slides);
  const deckGroups = slidesBySection(deck.slides);
  const filled: number[] = [];
  const skippedSections: string[] = [];
  const slides = [...deck.slides];

  for (const [sectionId, indexes] of deckGroups) {
    const thin = indexes.filter((i) => spokenWords(deck.slides[i]!.notes) < THIN_NOTES_WORDS);
    if (thin.length === 0) continue;
    const sources = skeletonGroups.get(sectionId) ?? [];
    if (sources.length !== indexes.length) {
      skippedSections.push(sectionId);
      continue;
    }
    indexes.forEach((deckIndex, rank) => {
      const slide = deck.slides[deckIndex]!;
      const source = skeleton.slides[sources[rank]!]!;
      if (spokenWords(slide.notes) >= THIN_NOTES_WORDS || spokenWords(source.notes) < THIN_NOTES_WORDS) return;
      const timing = TIMING.exec(slide.notes)?.[0]?.trim() ?? TIMING.exec(source.notes)?.[0]?.trim() ?? "";
      const spoken = source.notes.replace(TIMING, "").trim();
      const notes = clampText(timing ? `${timing} ${spoken}` : spoken, LIMITS.notes);
      slides[deckIndex] = { ...slide, bullets: [...slide.bullets], notes };
      filled.push(deckIndex + 1);
    });
  }

  filled.sort((a, b) => a - b);
  return filled.length > 0 ? { deck: { ...deck, slides }, filled, skippedSections } : { deck, filled, skippedSections };
}
