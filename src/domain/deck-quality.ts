import { checkDeckAgainstTemplate, COVER_SECTION_ID, isThinNotes, NOTES_TIMING } from "./deck";
import { sectionKind } from "./free/outline";
import { deaccent, extractTerms, normalizeText } from "./free/text";
import { truncateText } from "./normalize";
import { LIMITS, type DeckSpec, type PromptTemplate, type Section, type Slide } from "./schemas";
import { totalSlides } from "./slides";

/**
 * Contrôle qualité d'un deck produit par l'IA, et corrections déterministes —
 * fonctions pures (aucune base, aucun réseau), communes à tous les moteurs IA.
 *
 * - `assessFinalDeck` mesure ce qu'un modèle local rate le plus souvent : le
 *   nombre de diapos par ligne de trame, la recopie du contenu type de la ligne
 *   (notes et puces) et la réponse à la problématique dans la conclusion.
 * - `qualityFeedback` dit au modèle, pour UNE nouvelle tentative, ce qui manque.
 * - `enforceProblem` écrit la problématique tirée (couverture, diapo problématique).
 */

type Lang = PromptTemplate["language"];

/** Seuils au-delà desquels le deck est jugé hors cible (nouvelle tentative, puis avertissement). */
export const QUALITY_THRESHOLDS = {
  /** Similarité (Dice sur les racines) à partir de laquelle un texte est une recopie. */
  similarity: 0.8,
  /** Part maximale de notes recopiées du contenu type ou trop courtes (hors couverture). */
  notesToRewriteRate: 0.25,
  /** Part maximale de diapos dont les puces recopient le contenu type de leur ligne. */
  bulletsCopyRate: 0.5,
  /** Part minimale des mots de la problématique repris par la conclusion. */
  problemCoverage: 0.35,
  /**
   * Part minimale, dans la conclusion, des mots de la problématique ABSENTS de
   * la trame (titres et contenus types) : ce sont eux qui distinguent la
   * question tirée d'une conclusion générique qui ne ferait que reprendre la trame.
   */
  distinctiveCoverage: 0.3,
} as const;

/** En deçà, un texte est trop court pour parler de recopie (contenu type bref, intercalaire). */
const MIN_COMPARABLE_TERMS = 4;

export interface SectionGap {
  sectionId: string;
  title: string;
  expected: number;
  actual: number;
}

export interface FinalDeckQuality {
  sectionGaps: SectionGap[];
  /** Numéros de diapo (1 = couverture) dont la note recopie le contenu type de sa ligne. */
  copiedNotes: number[];
  /** Numéros de diapo dont la note est recopiée ou trop courte : à réécrire. */
  notesToRewrite: number[];
  /** Numéros de diapo dont les puces recopient le contenu type de leur ligne. */
  copiedBullets: number[];
  /** Notes recopiées / diapos hors couverture. */
  notesCopyRate: number;
  /** Notes recopiées ou trop courtes / diapos hors couverture. */
  notesToRewriteRate: number;
  /** Diapos aux puces recopiées / diapos hors couverture qui ont des puces. */
  bulletsCopyRate: number;
  /** Part des mots de la problématique repris dans la conclusion (0..1). */
  problemCoverage: number;
  problemAddressed: boolean;
  /** Dans tous les seuils. */
  ok: boolean;
  /** Gravité cumulée (plus petit = meilleur) pour départager deux tentatives. */
  score: number;
}

export interface QualityContext {
  template: PromptTemplate;
  problem: string;
}

// ---------------------------------------------------------------------------
// Outils texte
// ---------------------------------------------------------------------------

const SOURCE_LINE = /^\s*\[?\s*sources?\b|\[\s*source/i;

function stems(text: string): Set<string> {
  return new Set(extractTerms(text).map((t) => t.stem).filter((s) => s.length >= 2));
}

function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const x of a) if (b.has(x)) common += 1;
  return (2 * common) / (a.size + b.size);
}

function spoken(notes: string): string {
  return notes.replace(NOTES_TIMING, "").trim();
}

/** Puces de contenu (les lignes de source et marqueurs « [source à trouver] » sont écartés). */
function contentBullets(slide: Slide): string[] {
  return slide.bullets.filter((b) => !SOURCE_LINE.test(b));
}

function flat(value: string): string {
  return deaccent(normalizeText(value));
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/** « 2, 3, 4… » : liste de numéros de diapo bornée pour l'affichage. */
function slideList(numbers: readonly number[], max = 12): string {
  const shown = numbers.slice(0, max).join(", ");
  return numbers.length > max ? `${shown}…` : shown;
}

function plural(n: number, word: string): string {
  return n > 1 ? `${word}s` : word;
}

/** Ligne de la trame qui porte la problématique (la première), ou null. */
export function problemSection(template: PromptTemplate): Section | null {
  return template.sections.find((s) => sectionKind(s) === "problem") ?? null;
}

/** Lignes de conclusion de la trame ; à défaut, la dernière ligne. */
function conclusionSectionIds(template: PromptTemplate): Set<string> {
  const ids = template.sections.filter((s) => sectionKind(s) === "conclusion").map((s) => s.id);
  const last = template.sections[template.sections.length - 1];
  return new Set(ids.length > 0 ? ids : last ? [last.id] : []);
}

// ---------------------------------------------------------------------------
// Mesure
// ---------------------------------------------------------------------------

export function sectionGaps(deck: DeckSpec, template: PromptTemplate): SectionGap[] {
  const counts = new Map<string, number>();
  for (const slide of deck.slides) {
    if (slide.sectionId !== COVER_SECTION_ID) counts.set(slide.sectionId, (counts.get(slide.sectionId) ?? 0) + 1);
  }
  return template.sections
    .map((s) => ({ sectionId: s.id, title: s.title, expected: s.slides, actual: counts.get(s.id) ?? 0 }))
    .filter((g) => g.actual !== g.expected);
}

export function assessFinalDeck(deck: DeckSpec, ctx: QualityContext): FinalDeckQuality {
  const gaps = sectionGaps(deck, ctx.template);
  const body = deck.slides.map((slide, i) => ({ slide, number: i + 1 })).slice(1);

  // Référence de chaque diapo : le contenu type de SA ligne (une diapo d'une autre ligne ne compte pas).
  const guidanceBySection = new Map(ctx.template.sections.map((s) => [s.id, stems(s.guidance)]));
  const copies = (text: ReadonlySet<string>, reference: ReadonlySet<string> | undefined, minTerms: number) =>
    reference !== undefined &&
    text.size >= minTerms &&
    reference.size >= minTerms &&
    dice(text, reference) >= QUALITY_THRESHOLDS.similarity;

  const copiedNotes: number[] = [];
  const thinNotes: number[] = [];
  const copiedBullets: number[] = [];
  let withBullets = 0;
  for (const { slide, number } of body) {
    const reference = guidanceBySection.get(slide.sectionId);
    if (isThinNotes(slide.notes)) thinNotes.push(number);
    else if (copies(stems(spoken(slide.notes)), reference, MIN_COMPARABLE_TERMS)) copiedNotes.push(number);
    const bullets = contentBullets(slide);
    if (bullets.length > 0) {
      withBullets += 1;
      if (copies(stems(bullets.join(" ")), reference, MIN_COMPARABLE_TERMS - 1)) copiedBullets.push(number);
    }
  }
  const notesToRewrite = [...new Set([...copiedNotes, ...thinNotes])].sort((a, b) => a - b);

  const problemTerms = stems(ctx.problem);
  const conclusionIds = conclusionSectionIds(ctx.template);
  const conclusionText = deck.slides
    .filter((s) => conclusionIds.has(s.sectionId))
    .map((s) => [s.title, s.subtitle, ...s.bullets, s.notes].join(" "))
    .join(" ");
  const conclusionTerms = stems(conclusionText);
  let found = 0;
  for (const t of problemTerms) if (conclusionTerms.has(t)) found += 1;
  const problemCoverage = problemTerms.size === 0 ? 1 : found / problemTerms.size;
  const templateTerms = stems(ctx.template.sections.map((s) => `${s.title} ${s.guidance}`).join(" "));
  const distinctive = [...problemTerms].filter((t) => !templateTerms.has(t));
  const distinctiveFound = distinctive.filter((t) => conclusionTerms.has(t)).length;
  const problemAddressed =
    problemCoverage >= QUALITY_THRESHOLDS.problemCoverage &&
    (distinctive.length === 0 || distinctiveFound / distinctive.length >= QUALITY_THRESHOLDS.distinctiveCoverage);

  const notesCopyRate = rate(copiedNotes.length, body.length);
  const notesToRewriteRate = rate(notesToRewrite.length, body.length);
  const bulletsCopyRate = rate(copiedBullets.length, withBullets);
  const ok =
    gaps.length === 0 &&
    notesToRewriteRate <= QUALITY_THRESHOLDS.notesToRewriteRate &&
    bulletsCopyRate <= QUALITY_THRESHOLDS.bulletsCopyRate &&
    problemAddressed;
  const score =
    3 * gaps.reduce((sum, g) => sum + Math.abs(g.expected - g.actual), 0) +
    notesToRewrite.length +
    copiedBullets.length +
    (problemAddressed ? 0 : 5);

  return {
    sectionGaps: gaps,
    copiedNotes,
    notesToRewrite,
    copiedBullets,
    notesCopyRate,
    notesToRewriteRate,
    bulletsCopyRate,
    problemCoverage,
    problemAddressed,
    ok,
    score,
  };
}

/** Le meilleur de deux tentatives (à gravité égale, la plus récente : elle a reçu le retour). */
export function pickBetterDeck<T extends { quality: FinalDeckQuality }>(first: T, second: T): T {
  return second.quality.score <= first.quality.score ? second : first;
}

// ---------------------------------------------------------------------------
// Retour au modèle et avertissements
// ---------------------------------------------------------------------------

/** Donnée utilisateur citée dans un texte destiné au modèle : sans chevrons, sur une ligne. */
function quoted(text: string): string {
  return text.replace(/</g, "‹").replace(/>/g, "›").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * Consignes de correction pour UNE nouvelle tentative : sections à X diapos,
 * notes et puces à réécrire, conclusion à rattacher à la problématique.
 */
export function qualityFeedback(q: FinalDeckQuality, template: PromptTemplate): string {
  const en = template.language === "en";
  const total = totalSlides(template);
  const lines: string[] = [
    en
      ? "Your previous answer did not meet the requirements below. Produce a new COMPLETE answer (every slide) that fixes them:"
      : "Ta réponse précédente ne respecte pas les exigences ci-dessous. Produis une nouvelle réponse COMPLÈTE (toutes les diapos) qui les corrige :",
  ];
  if (q.sectionGaps.length > 0) {
    lines.push(
      en
        ? `- Number of slides: follow the outline exactly, ${total} slides in all (cover included). Lines to fix:`
        : `- Nombre de diapos : respecte exactement la trame, soit ${total} diapos au total (couverture comprise). Lignes à corriger :`,
    );
    for (const g of q.sectionGaps) {
      lines.push(
        en
          ? `  - « ${quoted(g.title)} » : ${g.expected} ${plural(g.expected, "slide")} (your answer had ${g.actual})`
          : `  - « ${quoted(g.title)} » : ${g.expected} ${plural(g.expected, "diapo")} (ta réponse en avait ${g.actual})`,
      );
    }
  }
  if (q.notesToRewrite.length > 0) {
    lines.push(
      en
        ? `- Speaker notes copied from the outline's content guidance or too short on slides ${slideList(q.notesToRewrite, 40)}: rewrite them entirely so that they answer the question.`
        : `- Notes d'orateur recopiées du contenu type de la trame ou trop courtes sur les diapos ${slideList(q.notesToRewrite, 40)} : réécris-les entièrement pour qu'elles servent la problématique.`,
    );
  }
  if (q.copiedBullets.length > 0) {
    lines.push(
      en
        ? `- Bullets copied from the outline's content guidance on slides ${slideList(q.copiedBullets, 40)}: rephrase them to serve the question.`
        : `- Puces recopiées du contenu type de la trame sur les diapos ${slideList(q.copiedBullets, 40)} : reformule-les au service de la problématique.`,
    );
  }
  if (!q.problemAddressed) {
    lines.push(
      en
        ? "- The conclusion does not answer the question provided: answer it explicitly, using its own terms."
        : "- La conclusion ne répond pas à la problématique fournie : réponds-y explicitement, en reprenant ses termes.",
    );
  }
  return lines.join("\n");
}

/** Avertissement de relecture relié aux diapos concernées (numéros, 1 = couverture ; vide = le deck entier). */
export interface ReviewItem {
  message: string;
  slides: number[];
}

/** Numéros (1 = couverture) des diapos de ces lignes de trame. */
function slidesOfSections(deck: DeckSpec, ids: ReadonlySet<string>): number[] {
  return deck.slides.flatMap((s, i) => (ids.has(s.sectionId) ? [i + 1] : []));
}

/** Avertissements de qualité, chacun relié à ses diapos ; `conclusionSlides` : diapos de la conclusion. */
function qualityReviewItems(q: FinalDeckQuality, conclusionSlides: number[] = []): ReviewItem[] {
  const items: ReviewItem[] = [];
  // Seul l'écart au seuil est signalé : quelques reprises isolées ne justifient pas une alerte.
  if (q.notesToRewriteRate > QUALITY_THRESHOLDS.notesToRewriteRate) {
    const n = q.notesToRewrite.length;
    items.push({
      message: `Notes d'orateur recopiées du contenu type de la trame ou trop courtes sur ${n} ${plural(n, "diapo")} (${slideList(q.notesToRewrite)}) : réécrivez-les pour votre problématique.`,
      slides: [...q.notesToRewrite],
    });
  }
  if (q.bulletsCopyRate > QUALITY_THRESHOLDS.bulletsCopyRate) {
    const n = q.copiedBullets.length;
    items.push({
      message: `Puces reprises telles quelles du contenu type de la trame sur ${n} ${plural(n, "diapo")} (${slideList(q.copiedBullets)}) : adaptez-les à votre problématique.`,
      slides: [...q.copiedBullets],
    });
  }
  if (!q.problemAddressed) {
    items.push({
      message: "La conclusion ne semble pas répondre à votre problématique : reformulez-la pour y répondre explicitement.",
      slides: conclusionSlides,
    });
  }
  return items;
}

/** Avertissements affichables (le nombre de diapos par ligne est signalé par `checkDeckAgainstTemplate`). */
export function qualityWarnings(q: FinalDeckQuality): string[] {
  return qualityReviewItems(q).map((i) => i.message);
}

// ---------------------------------------------------------------------------
// Problématique : injection dans le deck final
// ---------------------------------------------------------------------------

export interface DeckNames {
  /** Titre du sujet retenu ; null = deck sans sujet (la problématique tient lieu de titre). */
  themeName: string | null;
  /** Nom du projet : jamais un titre de couverture. */
  programName: string;
}

const QUESTION = /\?\s*[»"”)]*\s*$/;

function isProgramTitle(title: string, programName: string): boolean {
  const t = flat(title);
  const p = flat(programName);
  return t.length === 0 || (p.length > 0 && t.includes(p));
}

/** Phrases d'un texte, sans celles qui sont des questions. */
function withoutQuestions(text: string): string {
  return text
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => sentence.trim() && !QUESTION.test(sentence))
    .join(" ")
    .trim();
}

function timingOf(notes: string): string {
  return NOTES_TIMING.exec(notes)?.[0]?.trim() ?? "";
}

function joinNotes(...parts: string[]): string {
  return truncateText(parts.filter((p) => p.trim()).join(" ").trim(), LIMITS.notes);
}

/** Couverture et titre du deck : le titre du sujet (sans sujet : `fallback`) remplace le nom du projet. */
function withSubjectTitle(deck: DeckSpec, names: DeckNames, fallback: string): DeckSpec {
  const subject = truncateText((names.themeName ?? fallback).trim(), LIMITS.slideTitle);
  const slides = deck.slides.map((s, i) =>
    i === 0 && s.layout === "title" && isProgramTitle(s.title, names.programName) ? { ...s, bullets: [...s.bullets], title: subject } : s,
  );
  const coverTitle = slides[0]?.layout === "title" ? slides[0].title : subject;
  const title = isProgramTitle(deck.title, names.programName) ? truncateText(coverTitle, LIMITS.deckTitle) : deck.title;
  return { ...deck, title, slides };
}

/**
 * Deck final : la problématique TIRÉE est écrite par le code, quoi qu'ait
 * produit le modèle — en sous-titre de la couverture (et du deck) et sur la
 * première diapo de la ligne « problématique » de la trame, à la place de
 * toute question inventée. Le titre du sujet (sans sujet : la problématique)
 * remplace le nom du projet.
 */
export function enforceProblem(deck: DeckSpec, input: { template: PromptTemplate; problem: string } & DeckNames): DeckSpec {
  const problem = input.problem.replace(/\s+/g, " ").trim();
  const lang: Lang = input.template.language;
  const named = withSubjectTitle(deck, input, problem);
  const section = problemSection(input.template);
  const target = section ? named.slides.findIndex((s) => s.sectionId === section.id) : -1;

  const slides = named.slides.map((slide, i): Slide => {
    if (i === 0 && slide.layout === "title") {
      return { ...slide, bullets: [...slide.bullets], subtitle: truncateText(problem, LIMITS.slideSubtitle) };
    }
    if (i !== target || !section) return slide;
    const others = slide.bullets.filter((b) => !QUESTION.test(b) && flat(b) !== flat(problem));
    const fits = problem.length <= LIMITS.bullet;
    const bullets = fits ? [problem, ...others].slice(0, LIMITS.bullets) : others;
    const subtitle = fits ? (QUESTION.test(slide.subtitle) ? "" : slide.subtitle) : truncateText(problem, LIMITS.slideSubtitle);
    const title = QUESTION.test(slide.title) ? truncateText(section.title, LIMITS.slideTitle) : slide.title;
    const said = spoken(slide.notes);
    const notes = flat(said).includes(flat(problem))
      ? slide.notes
      : joinNotes(
          timingOf(slide.notes),
          lang === "en" ? `The question I will answer is: “${problem}”` : `La problématique à laquelle je réponds est la suivante : « ${problem} »`,
          withoutQuestions(said),
        );
    return { ...slide, title, subtitle, bullets, notes };
  });

  return {
    ...named,
    subtitle: truncateText(problem, LIMITS.deckSubtitle),
    slides,
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Pourcentage, ou nombre suivi d'une unité (millions, €, TWh, tonnes…). Une numérotation (« 01 - », « Front 2 ») n'en est pas un. */
const FIGURE = new RegExp(
  String.raw`\d(?:[\d   .,]*\d)?\s?(?:%|millions?(?![\p{L}])|milliards?(?![\p{L}])|mds?(?![\p{L}])|[mk]?€|\$|[kmgt]wh(?![\p{L}])|tonnes?(?![\p{L}])|kg(?![\p{L}])|tco2|fois(?![\p{L}]))`,
  "iu",
);

export interface UnsourcedFigure {
  /** Numéro de diapo (1 = couverture). */
  slide: number;
  title: string;
}

/**
 * Diapos qui AFFICHENT un chiffre (titre, sous-titre, puces) sans puce
 * « Source : … » ni marqueur « [source à trouver] » : la règle des faits
 * n'est pas vérifiable par le modèle, elle l'est ici.
 */
export function findUnsourcedFigures(deck: DeckSpec): UnsourcedFigure[] {
  const out: UnsourcedFigure[] = [];
  deck.slides.forEach((slide, i) => {
    const shown = [slide.title, slide.subtitle, ...contentBullets(slide)];
    if (!shown.some((t) => FIGURE.test(t))) return;
    const sourced = [slide.subtitle, ...slide.bullets].some((t) => SOURCE_LINE.test(t) || /\bsources?\s*:/i.test(t));
    if (!sourced) out.push({ slide: i + 1, title: slide.title });
  });
  return out;
}

export function unsourcedFigureWarning(figures: readonly UnsourcedFigure[]): string | null {
  if (figures.length === 0) return null;
  const list = figures.map((f) => `${f.slide} « ${f.title} »`).join(", ");
  return `Chiffre sans source affiché sur ${figures.length > 1 ? "les diapos" : "la diapo"} ${list} : ajoutez « Source : auteur, titre, année » ou retirez le chiffre.`;
}

/**
 * Diapos visées par un écart à la trame (message de `checkDeckAgainstTemplate`) :
 * celles de la section citée entre guillemets (titre, ou identifiant d'une
 * section inconnue), ou les couvertures pour un écart de couverture. Une
 * section absente n'a pas de diapo.
 */
function templateIssueSlides(issue: string, deck: DeckSpec, template: PromptTemplate): number[] {
  const cited = template.sections.filter((s) => issue.includes(`« ${s.title} »`)).map((s) => s.id);
  const unknown = deck.slides.map((s) => s.sectionId).filter((id) => issue.includes(`« ${id} »`));
  const ids = new Set([...cited, ...unknown]);
  if (ids.size > 0) return slidesOfSections(deck, ids);
  if (/couverture/i.test(issue)) return deck.slides.flatMap((s, i) => (s.layout === "title" ? [i + 1] : []));
  return [];
}

/**
 * Avertissements de relecture d'un deck final IA, recalculés à l'affichage
 * depuis le deck (aucune colonne de plus), chacun relié aux diapos concernées
 * (liens « Diapo N » de la relecture) : lignes dont le nombre de diapos diffère
 * de la trame, recopie du contenu type, conclusion hors problématique, chiffres
 * affichés sans source. Une correction de l'utilisateur fait disparaître
 * l'avertissement correspondant.
 */
export function finalDeckReviewItems(deck: DeckSpec, ctx: QualityContext): ReviewItem[] {
  const figures = findUnsourcedFigures(deck);
  const unsourced = unsourcedFigureWarning(figures);
  return [
    ...checkDeckAgainstTemplate(deck, ctx.template).map((message) => ({
      message,
      slides: templateIssueSlides(message, deck, ctx.template),
    })),
    ...qualityReviewItems(assessFinalDeck(deck, ctx), slidesOfSections(deck, conclusionSectionIds(ctx.template))),
    ...(unsourced ? [{ message: unsourced, slides: figures.map((f) => f.slide) }] : []),
  ];
}

/** Messages seuls de `finalDeckReviewItems` (compatibilité). */
export function finalDeckReview(deck: DeckSpec, ctx: QualityContext): string[] {
  return finalDeckReviewItems(deck, ctx).map((i) => i.message);
}
