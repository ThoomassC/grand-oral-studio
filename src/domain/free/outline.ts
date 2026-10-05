import type { ProgramContext, ThemeRef } from "../contracts";
import { COVER_SECTION_ID } from "../deck";
import { truncateText } from "../normalize";
import { DeckSpecSchema, LIMITS, stripControlChars, type DeckSpec, type PromptTemplate, type Section, type Slide, type SlideLayout } from "../schemas";
import { formatSeconds, templateTimings } from "../slides";
import { cleanProblem } from "./classifier";
import { deaccent, extractTerms, normalizeText } from "./text";

/**
 * Deck du jour J sans IA (moteur gratuit), pur et déterministe : la trame
 * remplie, construite uniquement à partir des données saisies (lignes de la
 * trame et leur contenu type, nom, description, mots-clés et notes du sujet,
 * problématique). Rien n'est inventé : chaque puce est soit une donnée de
 * l'utilisateur, soit une consigne de travail marquée « À compléter ».
 */

type Lang = "fr" | "en";
type SectionKind = "intro" | "problem" | "plan" | "part" | "conclusion";

/** Textes fixes du moteur gratuit (exportés pour vérifier qu'aucune puce n'est inventée). */
export const OUTLINE_TEXTS = {
  fr: {
    todo: "À compléter",
    and: "et",
    leads: "Pistes du sujet",
    keyTerms: "Notions clés à définir",
    problemTerms: "Termes de la problématique à définir",
    frame: "Cadre du sujet",
    yourNotes: "Vos notes",
    hook: "À compléter : une accroche (fait daté, chiffre sourcé ou situation concrète)",
    posedProblem: "Problématique posée",
    formulate: (subject: string) => `À compléter : la problématique, formulée comme une question sur « ${subject} »`,
    stake: "À compléter : l'enjeu, pourquoi cette question se pose aujourd'hui",
    tension: "À compléter : la tension, les réponses possibles qui s'opposent",
    planEmpty: "À compléter : annoncer 2 ou 3 parties, une phrase chacune",
    planPart: (n: number, titles: string) => `Partie ${n} : ${titles}`,
    opener: "À compléter : l'idée directrice de la partie, en une phrase",
    example: "À compléter : un exemple concret, daté et sourcé",
    figure: "À compléter : une donnée chiffrée vérifiée, avec sa source",
    column: (label: string) => `${label} : à compléter (2 ou 3 arguments)`,
    columnExample: "À compléter : un exemple à l'appui",
    link: "À compléter : en quoi cette diapo répond à la problématique",
    answer: "À compléter : la réponse explicite à la problématique (oui, non, à quelles conditions)",
    answerTo: (problem: string) => `Répondre explicitement à : ${problem}`,
    synthesis: (titles: string) => `Synthèse : ${titles}`,
    opening: "À compléter : une ouverture (question connexe, perspective)",
    defaultColumns: ["Points forts", "Points de vigilance"] as const,
    comparisonColumns: ["Premier terme", "Second terme"] as const,
    subtitleProgram: (program: string) => `Grand oral — ${program}`,
    notesCover: (subject: string, minutes: number) =>
      subject
        ? `Se présenter, annoncer le sujet « ${subject} » et la durée de l'oral (${minutes} min). Lire la problématique lentement.`
        : `Se présenter, annoncer la durée de l'oral (${minutes} min), puis lire la problématique lentement.`,
    notesGoal: (goal: string) => `Objectif de la diapo : ${goal}.`,
    notesTodo:
      "Trame sans IA : remplacez chaque « À compléter » par vos propres éléments ; ne citez que des faits et des chiffres vérifiés et sourcés.",
    notesKind: {
      intro: "Capter l'attention, poser le contexte, définir les termes.",
      problem: "Énoncer la question clairement, puis en montrer l'enjeu.",
      plan: "Annoncer les parties dans l'ordre où elles seront traitées.",
      part: "Développer une idée par diapo, appuyée sur un exemple.",
      conclusion: "Répondre explicitement à la problématique, résumer, ouvrir.",
    },
  },
  en: {
    todo: "To complete",
    and: "and",
    leads: "Subject leads",
    keyTerms: "Key notions to define",
    problemTerms: "Terms of the question to define",
    frame: "Subject scope",
    yourNotes: "Your notes",
    hook: "To complete: a hook (dated fact, sourced figure or concrete situation)",
    posedProblem: "Question addressed",
    formulate: (subject: string) => `To complete: the research question, phrased as a question about "${subject}"`,
    stake: "To complete: the stakes, why this question matters today",
    tension: "To complete: the tension, the competing possible answers",
    planEmpty: "To complete: announce 2 or 3 parts, one sentence each",
    planPart: (n: number, titles: string) => `Part ${n}: ${titles}`,
    opener: "To complete: the main idea of this part, in one sentence",
    example: "To complete: a concrete, dated and sourced example",
    figure: "To complete: a verified figure, with its source",
    column: (label: string) => `${label}: to complete (2 or 3 arguments)`,
    columnExample: "To complete: a supporting example",
    link: "To complete: how this slide answers the question",
    answer: "To complete: the explicit answer to the question (yes, no, under which conditions)",
    answerTo: (problem: string) => `Answer explicitly: ${problem}`,
    synthesis: (titles: string) => `Summary: ${titles}`,
    opening: "To complete: an opening (related question, outlook)",
    defaultColumns: ["Strengths", "Points of attention"] as const,
    comparisonColumns: ["First option", "Second option"] as const,
    subtitleProgram: (program: string) => `Oral exam — ${program}`,
    notesCover: (subject: string, minutes: number) =>
      subject
        ? `Introduce yourself, announce the subject "${subject}" and the length of the talk (${minutes} min). Read the question slowly.`
        : `Introduce yourself, announce the length of the talk (${minutes} min), then read the question slowly.`,
    notesGoal: (goal: string) => `Goal of the slide: ${goal}.`,
    notesTodo:
      "Outline without AI: replace every \"To complete\" with your own material; only quote verified, sourced facts and figures.",
    notesKind: {
      intro: "Catch attention, set the context, define the terms.",
      problem: "State the question clearly, then show what is at stake.",
      plan: "Announce the parts in the order they will be covered.",
      part: "One idea per slide, backed by an example.",
      conclusion: "Answer the question explicitly, sum up, open up.",
    },
  },
} as const;

const T = OUTLINE_TEXTS;

type Texts = (typeof T)[Lang];

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

/** Espaces fusionnés, sauf l'espace insécable (celui du « ? » final de la problématique). */
function clean(value: string): string {
  return stripControlChars(value).replace(/[^\S ]+/g, " ").trim();
}

const bounded = (value: string, max: number) => truncateText(clean(value), max);

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerFirst(value: string): string {
  // Ne pas abaisser un sigle (« RGPD », « IA »).
  return /^[A-Z\u00c0-\u00d6\u00d8-\u00de]{2}/.test(value) ? value : value.charAt(0).toLowerCase() + value.slice(1);
}

/** Texte de comparaison : minuscules, sans accents ni ponctuation. */
const flat = (value: string) => deaccent(normalizeText(value));

/** Phrases d'un contenu type (séparées par . ; ! ?). */
function sentences(value: string): string[] {
  return clean(value)
    .split(/[.;!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** « À compléter : x », ou « À compléter — x » si le texte contient déjà un deux-points. */
function todo(t: Texts, colon: string, text: string): string {
  const body = lowerFirst(text);
  return body.includes(":") ? `${t.todo} — ${body}` : `${t.todo}${colon}${body}`;
}

/** Regroupe des libellés en puces « Préfixe : a, b, c » de 180 caractères au plus, sans couper un libellé. */
function packList(prefix: string, items: readonly string[], separator: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const render = (list: string[]) => `${prefix}${separator}${list.join(", ")}`;
  for (const item of items) {
    if (current.length > 0 && render([...current, item]).length > LIMITS.bullet) {
      out.push(render(current));
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) out.push(render(current));
  return out.map((b) => bounded(b, LIMITS.bullet));
}

function uniqueCaseless(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = clean(raw);
    const key = flat(v);
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lecture de la trame
// ---------------------------------------------------------------------------

/** Nature d'une ligne de trame, d'après son id et son titre (le contenu type peut citer d'autres lignes). */
export function sectionKind(section: Pick<Section, "id" | "title">): SectionKind {
  const label = flat(`${section.id} ${section.title}`);
  if (/\b(conclusion|conclure|synthese|bilan|closing|wrap)\b/.test(label)) return "conclusion";
  if (/\b(intro|introduction|accroche|hook|opening)\b/.test(label)) return "intro";
  if (/\b(problem|problematique|problematic|question)\b/.test(label)) return "problem";
  if (/\b(plan|annonce|outline|sommaire|agenda|roadmap)\b/.test(label) && !/\bplan (d )?action\b|\baction plan\b/.test(label)) {
    return "plan";
  }
  return "part";
}

const POSITIVE = /^(avantages?|atouts?|forces?|benefices?|opportunites?|leviers?|enjeux|pour|advantages?|strengths?|benefits?|opportunities|opportunity|levers?|pros|stakes)$/;
const NEGATIVE = /^(limites?|inconvenients?|faiblesses?|menaces?|risques?|freins?|contre|obstacles?|limits?|limitations?|drawbacks?|weaknesses|weakness|threats?|risks?|challenges?|cons)$/;
const COMPARISON = /^(versus|vs|comparaison|comparer|compare|comparison|confronter)$/;

/**
 * Colonnes d'une diapo deux colonnes, si le contenu type oppose deux notions
 * (avantages/limites, enjeux/risques, leviers/freins…) ou demande une comparaison.
 */
export function twoColumnLabels(section: Pick<Section, "title" | "guidance">, lang: Lang = "fr"): readonly [string, string] | null {
  const words = normalizeText(`${section.title} ${section.guidance}`).split(" ").filter(Boolean);
  const positive = words.find((w) => POSITIVE.test(deaccent(w)));
  const negative = words.find((w) => NEGATIVE.test(deaccent(w)));
  if (positive && negative) return [capitalize(positive), capitalize(negative)];
  if (words.some((w) => COMPARISON.test(deaccent(w)))) return T[lang].comparisonColumns;
  return null;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

interface PlannedSlide {
  section: Section;
  kind: SectionKind;
  index: number;
  layout: SlideLayout;
  columns: readonly [string, string] | null;
}

/** Section d'une diapo qui ne fait que séparer deux parties (« Intercalaire Partie I », « Transition »). */
function isDivider(section: Pick<Section, "title">): boolean {
  return /^(intercalaire|transition|separateur|divider|section break)\b/.test(flat(section.title));
}

function planSlides(template: PromptTemplate): PlannedSlide[] {
  const planned: PlannedSlide[] = [];
  for (const section of template.sections) {
    const kind = sectionKind(section);
    const columns = twoColumnLabels(section, template.language);
    const divider = kind === "part" && isDivider(section);
    for (let index = 0; index < section.slides; index++) {
      const last = index === section.slides - 1;
      let layout: SlideLayout = "content";
      if (kind === "conclusion" && last) layout = "conclusion";
      else if (kind === "part" && index === 0 && (divider || section.slides >= 2)) layout = "section";
      else if (kind === "part" && columns && last) layout = "two-columns";
      planned.push({ section, kind, index, layout, columns: layout === "two-columns" ? columns : null });
    }
  }
  return planned;
}

/**
 * Répartit des éléments (mots-clés, éléments de notes du sujet), à tour de rôle,
 * sur les diapos de développement (« content » des lignes de partie), sinon sur
 * les diapos « content » des autres lignes, sinon sur toutes les diapos.
 */
function distribute(planned: PlannedSlide[], items: readonly string[]): Map<number, string[]> {
  const isSlot = (p: PlannedSlide, kinds: SectionKind[]) => p.layout === "content" && kinds.includes(p.kind);
  let slots = planned.map((p, i) => (isSlot(p, ["part"]) ? i : -1)).filter((i) => i >= 0);
  if (slots.length === 0) slots = planned.map((p, i) => (isSlot(p, ["part", "intro", "problem", "plan"]) ? i : -1)).filter((i) => i >= 0);
  if (slots.length === 0) slots = planned.map((_, i) => i);
  const bySlide = new Map<number, string[]>();
  items.forEach((item, k) => {
    const slot = slots[k % slots.length]!;
    bySlide.set(slot, [...(bySlide.get(slot) ?? []), item]);
  });
  return bySlide;
}

/** Parties du plan : titres des lignes de développement, regroupés en 3 blocs au plus. */
function planGroups(template: PromptTemplate): string[] {
  const parts = template.sections.filter((s) => sectionKind(s) === "part").map((s) => clean(s.title));
  const groups = Math.min(3, parts.length);
  const out: string[] = [];
  for (let g = 0; g < groups; g++) {
    const from = Math.floor((g * parts.length) / groups);
    const to = Math.floor(((g + 1) * parts.length) / groups);
    out.push(parts.slice(from, to).join(", "));
  }
  return out;
}

/** « Sujet — Projet », sans répéter le sujet quand le nom du projet le contient déjà (« Green IT — Gratuit »). */
function coverSubtitle(subjectName: string, programName: string): string {
  const subject = clean(subjectName);
  const program = clean(programName);
  if (!program) return subject;
  // Comparaison par mots entiers : le sujet « IT » n'est pas contenu dans « Audit ».
  if (!subject || ` ${flat(program)} `.includes(` ${flat(subject)} `)) return program;
  return `${subject} — ${program}`;
}

/** Puce (« - », « * », « • ») ou numéro (« 1. », « 12) ») en tête d'une ligne de notes. Une année (« 2022. ») n'en est pas un. */
const NOTE_MARKER = /^(?:[-*•‣◦·]+|\d{1,3}[.)])\s+/;
const MAX_NOTE_ITEMS = 30;

/**
 * Notes du sujet → éléments : une ligne = un élément ; puces et numéros de tête
 * retirés ; lignes vides ignorées ; chaque élément tronqué à la longueur d'une
 * puce ; 30 éléments au plus.
 */
export function splitSubjectNotes(notes: string): string[] {
  const items: string[] = [];
  for (const line of notes.split(/\r\n?|\n/)) {
    const item = clean(clean(line).replace(NOTE_MARKER, ""));
    if (!item) continue;
    items.push(truncateText(item, LIMITS.bullet));
    if (items.length === MAX_NOTE_ITEMS) break;
  }
  return items;
}

/** Éléments de notes posés en puces sur une diapo ; au-delà, ils vont dans les notes d'orateur. */
const MAX_NOTE_BULLETS = 3;

interface BuildInput {
  ctx: ProgramContext;
  /** Sujet retenu, ou null (deck sans sujet). */
  subject: ThemeRef | null;
  /** Problématique nettoyée, ou null si vide. */
  problem: string | null;
}

function buildDeck({ ctx, subject, problem }: BuildInput): DeckSpec {
  const template = ctx.template;
  const lang: Lang = template.language;
  const t = T[lang];
  const colon = lang === "fr" ? " : " : ": ";
  const planned = planSlides(template);
  const subjectName = subject ? clean(subject.name) : "";
  const keywords = uniqueCaseless(subject?.keywords ?? []);
  const keywordSlots = distribute(planned, keywords);
  const noteSlots = distribute(planned, subject ? splitSubjectNotes(subject.notes) : []);
  const groups = planGroups(template);
  const problemTerms = problem ? uniqueCaseless(extractTerms(problem).map((term) => term.surface)).slice(0, 5) : [];

  // Minutage identique à celui annoncé à l'IA (src/domain/prompts.ts) : durées fixées, sinon part égale.
  const timings = templateTimings(template);
  const span = (start: number, end: number) => `[${formatSeconds(start)}–${formatSeconds(end)}]`;
  const timing = (i: number) => {
    const slot = timings.slides[i] ?? { start: 0, end: 0 };
    return span(slot.start, slot.end);
  };

  const title = problem || subjectName || clean(ctx.name);
  const cover: Slide = {
    layout: "title",
    sectionId: COVER_SECTION_ID,
    title: bounded(title, LIMITS.slideTitle),
    subtitle: bounded(
      !problem ? t.subtitleProgram(ctx.name) : subject ? coverSubtitle(subject.name, ctx.name) : clean(ctx.name),
      LIMITS.slideSubtitle,
    ),
    bullets: [],
    notes: `${span(timings.cover.start, timings.cover.end)} ${t.notesCover(subjectName, template.durationMinutes)}`,
  };

  const slides = planned.map((p, i): Slide => {
    const { section, kind } = p;
    const sectionTitle = clean(section.title);
    const guidance = sentences(section.guidance);
    const assigned = keywordSlots.get(i) ?? [];
    const noteItems = noteSlots.get(i) ?? [];
    const leads = packList(t.leads, assigned, colon);
    const goal = clean(section.guidance) || sectionTitle;
    // Les éléments de notes passent en tête des puces (3 au plus), sauf sur une diapo deux colonnes (puces appariées).
    const noteBullets = p.layout === "two-columns" ? [] : noteItems.slice(0, MAX_NOTE_BULLETS);

    let title = section.slides > 1 ? `${sectionTitle} (${p.index + 1}/${section.slides})` : sectionTitle;
    let subtitle = "";
    let bullets: string[] = [];

    switch (kind) {
      case "intro":
        if (p.index === 0) {
          // L'accroche générique ne sert que si le contenu type de la ligne ne dit rien.
          bullets = guidance.length === 0 ? [t.hook] : [];
          if (subject?.description) bullets.push(`${t.frame}${colon}${clean(subject.description)}`);
          if (problem) bullets.push(`${t.posedProblem}${colon}${problem}`);
          const terms = problem && problemTerms.length > 0 ? problemTerms : keywords.slice(0, 4);
          if (terms.length > 0) bullets.push(...packList(problem && problemTerms.length > 0 ? t.problemTerms : t.keyTerms, terms, colon).slice(0, 1));
          title = sectionTitle;
        }
        bullets.push(...noteBullets, ...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      case "problem":
        if (p.index === 0) {
          bullets = problem ? [problem, t.stake, t.tension] : [t.formulate(subjectName || clean(ctx.name)), t.stake, t.tension];
          if (problem && subjectName) subtitle = subjectName;
          title = sectionTitle;
        }
        bullets.push(...noteBullets, ...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      case "plan":
        if (p.index === 0) {
          bullets = groups.length > 0 ? groups.map((titles, g) => t.planPart(g + 1, titles)) : [t.planEmpty];
          if (problem) subtitle = problem;
          title = sectionTitle;
        }
        bullets.push(...noteBullets, ...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      case "conclusion": {
        const last = p.index === section.slides - 1;
        if (last) {
          bullets = problem ? [t.answerTo(problem), t.answer] : [t.answer];
          if (groups.length > 0) bullets.push(t.synthesis(groups.join(" ; ")));
          bullets.push(t.opening);
          title = sectionTitle;
        }
        bullets.push(...noteBullets, ...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      }
      case "part":
        if (p.layout === "section") {
          title = sectionTitle;
          subtitle = clean(section.guidance);
          bullets = [...noteBullets, t.opener];
          if (problem) bullets.push(t.link);
        } else if (p.layout === "two-columns" && p.columns) {
          const [left, right] = p.columns;
          title = `${sectionTitle}${colon}${lowerFirst(left)} ${t.and} ${lowerFirst(right)}`;
          // Puces paires : splitColumns met la première moitié à gauche, la seconde à droite.
          bullets = [t.column(left), t.columnExample, t.column(right), t.columnExample];
          subtitle = assigned.length > 0 ? `${t.leads}${colon}${assigned.join(", ")}` : clean(section.guidance);
        } else {
          if (assigned.length > 0) title = `${sectionTitle}${colon}${capitalize(assigned[0]!)}`;
          bullets = [...noteBullets, ...leads, ...guidance.map((g) => todo(t, colon, g))];
          if (problem) bullets.push(t.link);
          bullets.push(t.example, t.figure);
        }
        break;
    }

    const finalBullets = bullets.map((b) => bounded(b, LIMITS.bullet)).filter((b) => b.length > 0).slice(0, LIMITS.bullets);
    // Aucun élément de notes n'est perdu : ce qui n'a pas trouvé place en puce va dans les notes d'orateur.
    const overflow = noteItems.filter((item) => !finalBullets.includes(item));
    const yours = overflow.length > 0 ? ` ${t.yourNotes}${colon}${overflow.join(" ; ")}.` : "";
    const notes = truncateText(
      `${timing(i)} ${t.notesGoal(goal.replace(/[.\s]+$/, ""))}${yours} ${t.notesKind[kind]} ${t.notesTodo}`,
      LIMITS.notes,
    );

    return {
      layout: p.layout,
      sectionId: section.id,
      title: bounded(title, LIMITS.slideTitle),
      subtitle: bounded(subtitle, LIMITS.slideSubtitle),
      bullets: finalBullets,
      notes,
    };
  });

  return DeckSpecSchema.parse({
    title: bounded(title, LIMITS.deckTitle),
    subtitle: cover.subtitle,
    slides: [cover, ...slides],
  });
}

/**
 * Deck du jour J sans IA : la problématique en titre, posée en introduction,
 * rappelée en conclusion ; le contenu type de chaque ligne devient des
 * consignes « À compléter » ; les mots-clés et les notes du sujet sont répartis
 * sur les diapos de développement. Sans sujet : problématique et trame seules.
 */
export function buildFreeFinalDeck(ctx: ProgramContext, subject: ThemeRef | null, problem: string): DeckSpec {
  return buildDeck({ ctx, subject, problem: cleanProblem(problem) || null });
}
