import type { ThemeRef } from "./contracts";
import { COVER_SECTION_ID, NOTES_TIMING } from "./deck";
import { deaccent } from "./free/text";
import { truncateText } from "./normalize";
import { plannedSecondsPerSlide, notesSpanSeconds } from "./rehearsal";
import type { DeckSpec, PromptTemplate, Slide } from "./schemas";
import { formatSeconds } from "./slides";

/**
 * Fiche de révision d'un sujet et fiche d'orateur imprimable d'un diaporama.
 * Fonctions pures : tout est relevé dans le texte saisi, rien n'est inventé.
 */

// ---------------------------------------------------------------------------
// Repérage dans le texte (partagé avec les questions du jury)
// ---------------------------------------------------------------------------

/** Nombre : « 31 », « 3,5 », « 1.2 », « 1 000 000 » (espaces fines ou insécables comprises). */
const NUMBER = String.raw`(?:\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)(?:[.,]\d+)?`;
/** Unités reconnues : sans unité, un nombre (année, numéro) n'est pas un chiffre clé. */
const UNIT = String.raw`(?:%|‰|pour\s?cents?|points?|millions?|milliards?|mds?|md€|[kmg]?€|euros?|\$|dollars?|[kmgt]wh|tonnes?|tco2(?:e|eq)?|kg|km\/h|km|m²|m³|ha|hectares?|°\s?c|ans|années|mois|jours|heures|habitants|personnes|salariés|emplois|élèves|étudiants|foyers|ménages|fois)`;
const FIGURE = new RegExp(String.raw`(?<![\p{L}\d])${NUMBER}\s?${UNIT}(?![\p{L}\d])`, "iu");

const SOURCE_LINE = /\bsources?\s*:\s*(.+)$/i;
/** Marqueurs « à compléter » : ce ne sont pas des sources. */
const PLACEHOLDER = /\[\s*source|\bà (trouver|préciser|compléter)\b|\bto (find|be found)\b/i;
const URL = /https?:\/\/[^\s<>"'«»)\]]+/g;
const OBJECTION = /^\s*objection probable\s*:/i;

/** Clé de comparaison : minuscules, sans accents, espaces fusionnés. */
export function flatKey(value: string): string {
  return deaccent(value).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Valeurs nettoyées et dédoublonnées sans tenir compte de la casse ni des accents (première forme gardée). */
export function uniqueCaseless(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = flatKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Notes sans le repère de minutage de tête. */
export function spokenNotes(notes: string): string {
  return notes.replace(NOTES_TIMING, "").trim();
}

function lines(text: string): string[] {
  return text
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Phrases d'un texte : par ligne, puis après « . ! ? … » suivi d'une majuscule. */
export function sentences(text: string): string[] {
  return lines(text).flatMap((line) =>
    line
      .split(/(?<=[.!?…])\s+(?=[\p{Lu}«"“(])/u)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Premier chiffre accompagné d'une unité (« 31 % », « 12 millions »), ou null. */
export function findFigure(text: string): string | null {
  return text.match(FIGURE)?.[0] ?? null;
}

/** Phrases qui portent un chiffre avec unité (lignes de source et objections exclues). */
export function figureSentences(text: string): string[] {
  return sentences(text).filter((s) => !SOURCE_LINE.test(s) && !OBJECTION.test(s) && FIGURE.test(s));
}

/**
 * Sources d'un texte : le contenu des lignes « Source(s) : … » (sans les marqueurs
 * « à trouver »), et les URL des autres lignes (ponctuation finale retirée).
 */
export function findSources(text: string): string[] {
  const out: string[] = [];
  for (const line of lines(text)) {
    const source = line.match(SOURCE_LINE);
    if (source) {
      if (!PLACEHOLDER.test(line)) out.push(source[1]!.trim());
      continue;
    }
    for (const url of line.match(URL) ?? []) out.push(url.replace(/[.,;:!?]+$/, ""));
  }
  return out;
}

/** « Premier axe (1/2) » → « Premier axe ». */
export function baseTitle(title: string): string {
  return title.replace(/\s*\(\d+\s*\/\s*\d+\)\s*$/, "").trim();
}

/** Diapos consécutives d'une même ligne de trame (sectionId). */
export function sectionGroups(spec: DeckSpec): { sectionId: string; first: number; slides: Slide[] }[] {
  const groups: { sectionId: string; first: number; slides: Slide[] }[] = [];
  spec.slides.forEach((slide, i) => {
    const last = groups[groups.length - 1];
    if (last && last.sectionId === slide.sectionId) last.slides.push(slide);
    else groups.push({ sectionId: slide.sectionId, first: i, slides: [slide] });
  });
  return groups;
}

// ---------------------------------------------------------------------------
// Fiche de révision
// ---------------------------------------------------------------------------

export interface OutlineEntry {
  title: string;
  /** Durée de la ligne, arrondie à la demi-minute ; absente si une de ses diapos n'a pas de repère « [m:ss–m:ss] ». */
  minutes?: number;
}

export interface RevisionSheet {
  title: string;
  /** Phrases portant un chiffre avec unité (notes du sujet, puis puces et notes du diaporama). */
  keyFigures: string[];
  /** Lignes « Source : … » et URL relevées. */
  sources: string[];
  keywords: string[];
  /** Plan du dernier diaporama, par ligne de trame, sans la couverture. */
  outline: OutlineEntry[];
}

const MAX_FIGURES = 12;
const MAX_SOURCES = 12;
const FIGURE_SENTENCE_MAX = 240;
const DEFAULT_TITLE = "Fiche de révision";

function deckText(spec: DeckSpec): string {
  return spec.slides.map((s) => [...s.bullets, spokenNotes(s.notes)].join("\n")).join("\n");
}

function outlineOf(spec: DeckSpec): OutlineEntry[] {
  return sectionGroups(spec)
    .filter((g) => g.sectionId !== COVER_SECTION_ID)
    .map((g) => {
      const title = baseTitle(g.slides[0]!.title);
      const spans = g.slides.map((s) => notesSpanSeconds(s.notes));
      if (spans.some((s) => s === null)) return { title };
      const seconds = spans.reduce<number>((sum, s) => sum + (s ?? 0), 0);
      return { title, minutes: Math.round((seconds / 60) * 2) / 2 };
    });
}

/**
 * Fiche de révision : titre (sujet, sinon titre du diaporama, sinon « Fiche de
 * révision »), chiffres clés et sources relevés dans les notes du sujet puis dans
 * le dernier diaporama, mots-clés du sujet, plan du diaporama.
 */
export function buildRevisionSheet(subject: ThemeRef | null, lastDeck: DeckSpec | null): RevisionSheet {
  const texts = [subject?.notes ?? "", lastDeck ? deckText(lastDeck) : ""];
  const title = subject?.name.trim() || lastDeck?.title.trim() || DEFAULT_TITLE;
  return {
    title,
    keyFigures: uniqueCaseless(texts.flatMap(figureSentences))
      .slice(0, MAX_FIGURES)
      .map((s) => truncateText(s, FIGURE_SENTENCE_MAX)),
    sources: uniqueCaseless(texts.flatMap(findSources)).slice(0, MAX_SOURCES),
    keywords: uniqueCaseless(subject?.keywords ?? []),
    outline: lastDeck ? outlineOf(lastDeck) : [],
  };
}

// ---------------------------------------------------------------------------
// Fiche d'orateur imprimable
// ---------------------------------------------------------------------------

export interface NotesSheetSlide {
  /** Numéro affiché (1 = couverture). */
  number: number;
  title: string;
  sectionTitle: string;
  /** Secondes depuis le début de l'oral. */
  start: number;
  end: number;
  /** « 2:30–4:00 ». */
  timing: string;
  bullets: string[];
  /** Notes sans le repère de minutage. */
  notes: string;
}

export interface NotesSheetPlanEntry {
  title: string;
  start: number;
  end: number;
  timing: string;
}

export interface DeckNotesSheet {
  title: string;
  subtitle: string;
  durationMinutes: number;
  plan: NotesSheetPlanEntry[];
  slides: NotesSheetSlide[];
}

const COVER_TITLE = "Couverture";

/**
 * Fiche d'orateur : plan par ligne, puis chaque diapo avec son minutage
 * (`plannedSecondsPerSlide`, cumulé depuis 0:00), ses puces et ses notes. Le nom
 * de ligne vient de la trame ; une diapo hors trame est nommée par son titre.
 */
export function buildDeckNotesSheet(spec: DeckSpec, template: PromptTemplate): DeckNotesSheet {
  const planned = plannedSecondsPerSlide(spec, template);
  const sectionTitles = new Map(template.sections.map((s) => [s.id, s.title]));
  const sectionTitle = (slide: Slide) =>
    slide.sectionId === COVER_SECTION_ID ? COVER_TITLE : (sectionTitles.get(slide.sectionId) ?? baseTitle(slide.title));
  const span = (start: number, end: number) => `${formatSeconds(start)}–${formatSeconds(end)}`;

  let cursor = 0;
  const slides = spec.slides.map((slide, i): NotesSheetSlide => {
    const start = cursor;
    cursor += planned[i] ?? 0;
    return {
      number: i + 1,
      title: slide.title,
      sectionTitle: sectionTitle(slide),
      start,
      end: cursor,
      timing: span(start, cursor),
      bullets: [...slide.bullets],
      notes: spokenNotes(slide.notes),
    };
  });

  const plan = sectionGroups(spec).map((g): NotesSheetPlanEntry => {
    const first = slides[g.first]!;
    const end = slides[g.first + g.slides.length - 1]!.end;
    return { title: first.sectionTitle, start: first.start, end, timing: span(first.start, end) };
  });

  return { title: spec.title, subtitle: spec.subtitle, durationMinutes: template.durationMinutes, plan, slides };
}
