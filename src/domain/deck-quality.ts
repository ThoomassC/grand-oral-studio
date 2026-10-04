import { checkDeckAgainstTemplate, COVER_SECTION_ID, isThinNotes, NOTES_TIMING } from "./deck";
import { sectionKind } from "./free/skeleton";
import { deaccent, extractTerms, normalizeText } from "./free/text";
import { truncateText } from "./normalize";
import { LIMITS, type DeckSpec, type PromptTemplate, type Section, type Slide } from "./schemas";
import { totalSlides } from "./slides";

/**
 * Contrôle qualité d'un deck produit par l'IA, et corrections déterministes —
 * fonctions pures (aucune base, aucun réseau), communes à tous les moteurs IA.
 *
 * - `assessFinalDeck` mesure ce qu'un modèle local rate le plus souvent : le
 *   nombre de diapos par section, la recopie du squelette (notes et puces) et la
 *   réponse à la problématique dans la conclusion.
 * - `qualityFeedback` dit au modèle, pour UNE nouvelle tentative, ce qui manque.
 * - `enforceProblem` / `neutralizeSkeletonProblem` écrivent la problématique
 *   tirée (deck final) ou retirent celle que le modèle aurait inventée (squelette).
 */

type Lang = PromptTemplate["language"];

/** Seuils au-delà desquels le deck est jugé hors cible (nouvelle tentative, puis avertissement). */
export const QUALITY_THRESHOLDS = {
  /** Similarité (Dice sur les racines) à partir de laquelle un texte est une recopie. */
  similarity: 0.8,
  /** Part maximale de notes recopiées du squelette ou trop courtes (hors couverture). */
  notesToRewriteRate: 0.25,
  /** Part maximale de diapos dont les puces sont celles du squelette. */
  bulletsCopyRate: 0.5,
  /** Part minimale des mots de la problématique repris par la conclusion. */
  problemCoverage: 0.35,
  /**
   * Part minimale, dans la conclusion, des mots de la problématique ABSENTS du
   * squelette : ce sont eux qui distinguent la question tirée d'une question
   * générique (sinon une conclusion recopiée du squelette passerait).
   */
  distinctiveCoverage: 0.3,
} as const;

/** En deçà, un texte est trop court pour parler de recopie (consigne, intercalaire). */
const MIN_COMPARABLE_TERMS = 4;

export interface SectionGap {
  sectionId: string;
  title: string;
  expected: number;
  actual: number;
}

export interface FinalDeckQuality {
  sectionGaps: SectionGap[];
  /** Numéros de diapo (1 = couverture) dont la note recopie une note du squelette. */
  copiedNotes: number[];
  /** Numéros de diapo dont la note est recopiée ou trop courte : à réécrire. */
  notesToRewrite: number[];
  /** Numéros de diapo dont les puces sont celles du squelette. */
  copiedBullets: number[];
  /** Notes recopiées / diapos hors couverture (0 sans squelette). */
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
  skeleton: DeckSpec | null;
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

/** Section du gabarit qui porte la problématique (la première), ou null. */
export function problemSection(template: PromptTemplate): Section | null {
  return template.sections.find((s) => sectionKind(s) === "problem") ?? null;
}

/** Sections de conclusion du gabarit ; à défaut, la dernière section. */
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

  const skeletonNotes = (ctx.skeleton?.slides ?? []).map((s) => stems(spoken(s.notes))).filter((s) => s.size >= MIN_COMPARABLE_TERMS);
  const skeletonBullets = (ctx.skeleton?.slides ?? [])
    .map((s) => stems(contentBullets(s).join(" ")))
    .filter((s) => s.size >= MIN_COMPARABLE_TERMS - 1);
  const copies = (text: Set<string>, pool: readonly Set<string>[]) =>
    pool.some((candidate) => dice(text, candidate) >= QUALITY_THRESHOLDS.similarity);

  const copiedNotes: number[] = [];
  const thinNotes: number[] = [];
  const copiedBullets: number[] = [];
  let withBullets = 0;
  for (const { slide, number } of body) {
    if (isThinNotes(slide.notes)) thinNotes.push(number);
    else {
      const terms = stems(spoken(slide.notes));
      if (terms.size >= MIN_COMPARABLE_TERMS && copies(terms, skeletonNotes)) copiedNotes.push(number);
    }
    const bullets = contentBullets(slide);
    if (bullets.length > 0) {
      withBullets += 1;
      const terms = stems(bullets.join(" "));
      if (terms.size >= MIN_COMPARABLE_TERMS - 1 && copies(terms, skeletonBullets)) copiedBullets.push(number);
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
  const skeletonTerms = ctx.skeleton
    ? stems(ctx.skeleton.slides.map((s) => [s.title, s.subtitle, ...s.bullets, s.notes].join(" ")).join(" "))
    : new Set<string>();
  const distinctive = [...problemTerms].filter((t) => !skeletonTerms.has(t));
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
        ? `- Number of slides: follow the template exactly, ${total} slides in all (cover included). Sections to fix:`
        : `- Nombre de diapos : respecte exactement le gabarit, soit ${total} diapos au total (couverture comprise). Sections à corriger :`,
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
        ? `- Speaker notes copied from the skeleton or too short on slides ${slideList(q.notesToRewrite, 40)}: rewrite them entirely so that they answer the question.`
        : `- Notes d'orateur recopiées du squelette ou trop courtes sur les diapos ${slideList(q.notesToRewrite, 40)} : réécris-les entièrement pour qu'elles servent la problématique.`,
    );
  }
  if (q.copiedBullets.length > 0) {
    lines.push(
      en
        ? `- Bullets copied from the skeleton on slides ${slideList(q.copiedBullets, 40)}: rephrase them to serve the question.`
        : `- Puces recopiées du squelette sur les diapos ${slideList(q.copiedBullets, 40)} : reformule-les au service de la problématique.`,
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

/** Avertissements affichables (le nombre de diapos par section est signalé par `checkDeckAgainstTemplate`). */
export function qualityWarnings(q: FinalDeckQuality): string[] {
  const warnings: string[] = [];
  // Seul l'écart au seuil est signalé : quelques reprises isolées ne justifient pas une alerte.
  if (q.notesToRewriteRate > QUALITY_THRESHOLDS.notesToRewriteRate) {
    const n = q.notesToRewrite.length;
    warnings.push(
      `Notes d'orateur recopiées du squelette ou trop courtes sur ${n} ${plural(n, "diapo")} (${slideList(q.notesToRewrite)}) : réécrivez-les pour votre problématique.`,
    );
  }
  if (q.bulletsCopyRate > QUALITY_THRESHOLDS.bulletsCopyRate) {
    const n = q.copiedBullets.length;
    warnings.push(
      `Puces reprises telles quelles du squelette sur ${n} ${plural(n, "diapo")} (${slideList(q.copiedBullets)}) : adaptez-les à votre problématique.`,
    );
  }
  if (!q.problemAddressed) {
    warnings.push("La conclusion ne semble pas répondre à votre problématique : reformulez-la pour y répondre explicitement.");
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Problématique : injection (deck final) et neutralisation (squelette)
// ---------------------------------------------------------------------------

export const SKELETON_PROBLEM_PLACEHOLDER = "[problématique tirée le jour J]";
const SKELETON_PROBLEM_PLACEHOLDER_EN = "[question drawn on the day]";

export interface DeckNames {
  /** Titre du sujet (nom du thème). */
  themeName: string;
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

/** Couverture et titre du deck : le titre du sujet remplace le nom du projet. */
function withSubjectTitle(deck: DeckSpec, names: DeckNames): DeckSpec {
  const subject = truncateText(names.themeName.trim(), LIMITS.slideTitle);
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
 * première diapo de la section « problématique » du gabarit, à la place de
 * toute question inventée. Le titre du sujet remplace le nom du projet.
 */
export function enforceProblem(deck: DeckSpec, input: { template: PromptTemplate; problem: string } & DeckNames): DeckSpec {
  const problem = input.problem.replace(/\s+/g, " ").trim();
  const lang: Lang = input.template.language;
  const named = withSubjectTitle(deck, input);
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

/**
 * Squelette : générique, il ne formule AUCUNE problématique. Une question
 * inventée par le modèle dans la section « problématique » est retirée (titre,
 * sous-titre, puces, notes) et remplacée par un marqueur. Le titre du sujet
 * remplace le nom du projet en couverture.
 */
export function neutralizeSkeletonProblem(deck: DeckSpec, template: PromptTemplate, names: DeckNames): DeckSpec {
  const named = withSubjectTitle(deck, names);
  const section = problemSection(template);
  if (!section) return named;
  const placeholder = template.language === "en" ? SKELETON_PROBLEM_PLACEHOLDER_EN : SKELETON_PROBLEM_PLACEHOLDER;
  const first = named.slides.findIndex((s) => s.sectionId === section.id);

  const slides = named.slides.map((slide, i): Slide => {
    if (slide.sectionId !== section.id) return slide;
    const kept = slide.bullets.filter((b) => !QUESTION.test(b));
    const bullets = i === first && !kept.includes(placeholder) ? [placeholder, ...kept].slice(0, LIMITS.bullets) : kept;
    const title = QUESTION.test(slide.title) ? truncateText(section.title, LIMITS.slideTitle) : slide.title;
    const subtitle = QUESTION.test(slide.subtitle) ? "" : slide.subtitle;
    const said = withoutQuestions(spoken(slide.notes));
    const lead =
      i === first && !said.includes(placeholder)
        ? template.language === "en"
          ? `${placeholder}: I will state it slowly, then show what is at stake.`
          : `${placeholder} : je l'énoncerai lentement, puis j'en montrerai l'enjeu.`
        : "";
    const notes = joinNotes(timingOf(slide.notes), lead, said);
    return { ...slide, title, subtitle, bullets, notes };
  });
  return { ...named, slides };
}

// ---------------------------------------------------------------------------
// Sources et fraîcheur du squelette
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

export interface SkeletonStaleness {
  stale: boolean;
  reason: string | null;
}

/** Squelette qui ne suit plus le gabarit actuel (gabarit modifié depuis, ou squelette hors gabarit) : à régénérer. */
export function skeletonStaleness(spec: DeckSpec, template: PromptTemplate): SkeletonStaleness {
  const expected = totalSlides(template);
  if (spec.slides.length !== expected) {
    return { stale: true, reason: `Ne suit plus le gabarit actuel : ${spec.slides.length} diapos au lieu de ${expected}.` };
  }
  if (checkDeckAgainstTemplate(spec, template).length > 0) {
    return { stale: true, reason: "Ne suit plus le gabarit actuel : sections différentes." };
  }
  return { stale: false, reason: null };
}

/**
 * Avertissements de relecture d'un deck final IA, recalculés à l'affichage
 * depuis le deck enregistré (aucune colonne de plus) : sections dont le nombre
 * de diapos diffère du gabarit, recopie du squelette, conclusion hors
 * problématique, chiffres affichés sans source. Une correction de l'utilisateur
 * fait disparaître l'avertissement correspondant.
 */
export function finalDeckReview(deck: DeckSpec, ctx: QualityContext): string[] {
  const unsourced = unsourcedFigureWarning(findUnsourcedFigures(deck));
  return [
    ...checkDeckAgainstTemplate(deck, ctx.template),
    ...qualityWarnings(assessFinalDeck(deck, ctx)),
    ...(unsourced ? [unsourced] : []),
  ];
}
