import type { ProgramContext, ThemeRef } from "../contracts";
import { checkDeckAgainstTemplate, COVER_SECTION_ID } from "../deck";
import { truncateText } from "../normalize";
import { DeckSpecSchema, LIMITS, stripControlChars, type DeckSpec, type PromptTemplate, type Section, type Slide, type SlideLayout } from "../schemas";
import { totalSlides } from "../slides";
import { cleanProblem } from "./classifier";
import { deaccent, extractTerms, normalizeText } from "./text";

/**
 * Decks gratuits et déterministes, sans IA : une trame conforme au gabarit,
 * construite uniquement à partir des données saisies (sections du gabarit,
 * nom, description et mots-clés du thème, problématique). Rien n'est inventé :
 * chaque puce est soit une donnée du thème, soit une consigne de travail
 * marquée « À compléter ».
 */

type Lang = "fr" | "en";
type SectionKind = "intro" | "problem" | "plan" | "part" | "conclusion";

const T = {
  fr: {
    todo: "À compléter",
    and: "et",
    leads: "Pistes du thème",
    keyTerms: "Notions clés à définir",
    problemTerms: "Termes de la problématique à définir",
    frame: "Cadre du thème",
    hook: "À compléter : une accroche (fait daté, chiffre sourcé ou situation concrète)",
    posedProblem: "Problématique posée",
    formulate: (theme: string) => `À compléter : la problématique, formulée comme une question sur « ${theme} »`,
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
    subtitleSkeleton: (program: string) => `Grand oral — ${program}`,
    notesCover: (theme: string, minutes: number, final: boolean) =>
      `Se présenter, annoncer le thème « ${theme} » et la durée de l'oral (${minutes} min).` +
      (final ? " Lire la problématique lentement." : ""),
    notesGoal: (goal: string) => `Objectif de la diapo : ${goal}.`,
    notesTodo:
      "Trame gratuite : remplacez chaque « À compléter » par vos propres éléments ; ne citez que des faits et des chiffres vérifiés et sourcés.",
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
    leads: "Theme leads",
    keyTerms: "Key notions to define",
    problemTerms: "Terms of the question to define",
    frame: "Theme scope",
    hook: "To complete: a hook (dated fact, sourced figure or concrete situation)",
    posedProblem: "Question addressed",
    formulate: (theme: string) => `To complete: the research question, phrased as a question about "${theme}"`,
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
    subtitleSkeleton: (program: string) => `Oral exam — ${program}`,
    notesCover: (theme: string, minutes: number, final: boolean) =>
      `Introduce yourself, announce the theme "${theme}" and the length of the talk (${minutes} min).` +
      (final ? " Read the question slowly." : ""),
    notesGoal: (goal: string) => `Goal of the slide: ${goal}.`,
    notesTodo:
      "Free outline: replace every \"To complete\" with your own material; only quote verified, sourced facts and figures.",
    notesKind: {
      intro: "Catch attention, set the context, define the terms.",
      problem: "State the question clearly, then show what is at stake.",
      plan: "Announce the parts in the order they will be covered.",
      part: "One idea per slide, backed by an example.",
      conclusion: "Answer the question explicitly, sum up, open up.",
    },
  },
} as const;

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

function mmss(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Texte de comparaison : minuscules, sans accents ni ponctuation. */
const flat = (value: string) => deaccent(normalizeText(value));

/** Phrases d'une consigne (séparées par . ; ! ?). */
function sentences(value: string): string[] {
  return clean(value)
    .split(/[.;!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** « À compléter : x », ou « À compléter — x » si la consigne contient déjà un deux-points. */
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
// Lecture du gabarit
// ---------------------------------------------------------------------------

/** Nature d'une section, d'après son id et son titre (la consigne peut citer d'autres sections). */
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
 * Colonnes d'une diapo deux colonnes, si la consigne oppose deux notions
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

/** Répartit les mots-clés du thème, à tour de rôle, sur les diapos de développement. */
function distributeKeywords(planned: PlannedSlide[], keywords: string[]): Map<number, string[]> {
  const isSlot = (p: PlannedSlide, kinds: SectionKind[]) => p.layout === "content" && kinds.includes(p.kind);
  let slots = planned.map((p, i) => (isSlot(p, ["part"]) ? i : -1)).filter((i) => i >= 0);
  if (slots.length === 0) slots = planned.map((p, i) => (isSlot(p, ["part", "intro", "problem", "plan"]) ? i : -1)).filter((i) => i >= 0);
  if (slots.length === 0) slots = planned.map((_, i) => i);
  const bySlide = new Map<number, string[]>();
  keywords.forEach((keyword, k) => {
    const slot = slots[k % slots.length];
    bySlide.set(slot, [...(bySlide.get(slot) ?? []), keyword]);
  });
  return bySlide;
}

/** Parties du plan : titres des sections de développement, regroupés en 3 blocs au plus. */
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

/** « Thème — Projet », sans répéter le thème quand le nom du projet le contient déjà (« Green IT — Gratuit »). */
function coverSubtitle(themeName: string, programName: string): string {
  const theme = clean(themeName);
  const program = clean(programName);
  if (!program) return theme;
  // Comparaison par mots entiers : le thème « IT » n'est pas contenu dans « Audit ».
  if (!theme || ` ${flat(program)} `.includes(` ${flat(theme)} `)) return program;
  return `${theme} — ${program}`;
}

interface BuildInput {
  ctx: ProgramContext;
  theme: ThemeRef;
  /** Problématique nettoyée (deck final), ou null (squelette). */
  problem: string | null;
  /** Squelette conforme au gabarit dont on reprend les diapos de développement. */
  base: DeckSpec | null;
}

function buildDeck({ ctx, theme, problem, base }: BuildInput): DeckSpec {
  const template = ctx.template;
  const lang: Lang = template.language;
  const t = T[lang];
  const colon = lang === "fr" ? " : " : ": ";
  const planned = planSlides(template);
  const keywords = uniqueCaseless(theme.keywords);
  const keywordSlots = distributeKeywords(planned, keywords);
  const groups = planGroups(template);
  const problemTerms = problem ? uniqueCaseless(extractTerms(problem).map((term) => term.surface)).slice(0, 5) : [];

  // Minutage identique à celui annoncé à l'IA (src/domain/prompts.ts).
  const total = totalSlides(template);
  const totalSeconds = template.durationMinutes * 60;
  const coverSeconds = Math.min(30, totalSeconds / total);
  const perSlide = (totalSeconds - coverSeconds) / Math.max(1, total - 1);
  const timing = (i: number) => `[${mmss(coverSeconds + i * perSlide)}–${mmss(coverSeconds + (i + 1) * perSlide)}]`;

  const cover: Slide = {
    layout: "title",
    sectionId: COVER_SECTION_ID,
    title: bounded(problem || theme.name, LIMITS.slideTitle),
    subtitle: bounded(problem ? coverSubtitle(theme.name, ctx.name) : t.subtitleSkeleton(ctx.name), LIMITS.slideSubtitle),
    bullets: [],
    notes: `[0:00–${mmss(coverSeconds)}] ${t.notesCover(clean(theme.name), template.durationMinutes, problem !== null)}`,
  };

  const baseSlides = base ? base.slides.filter((s) => s.sectionId !== COVER_SECTION_ID) : null;

  const slides = planned.map((p, i): Slide => {
    const { section, kind } = p;
    const sectionTitle = clean(section.title);
    const guidance = sentences(section.guidance);
    const assigned = keywordSlots.get(i) ?? [];
    const leads = packList(t.leads, assigned, colon);
    const goal = clean(section.guidance) || sectionTitle;
    const notes = (spoken: string) =>
      truncateText(`${timing(i)} ${t.notesGoal(goal.replace(/[.\s]+$/, ""))} ${spoken} ${t.notesTodo}`, LIMITS.notes);

    // Deck final avec squelette : les diapos de développement du squelette sont reprises.
    const candidate = kind === "part" && baseSlides ? baseSlides[i] : undefined;
    const reused = candidate && candidate.sectionId === section.id ? candidate : undefined;
    if (reused) {
      const spoken = reused.notes.replace(/^\s*\[[^\]]*\]\s*/, "").trim() || t.notesKind.part;
      const own = reused.bullets.map((b) => bounded(b, LIMITS.bullet)).filter((b) => b.length > 0).slice(0, LIMITS.bullets);
      // La consigne de lien ne prend jamais la place d'une puce de l'utilisateur : sans place, elle va dans les notes.
      const linkAsBullet = reused.layout !== "two-columns" && own.length < LIMITS.bullets;
      const linkInNotes = reused.layout !== "two-columns" && !linkAsBullet;
      return {
        layout: reused.layout === "title" ? "content" : reused.layout,
        sectionId: section.id,
        title: bounded(reused.title, LIMITS.slideTitle),
        subtitle: bounded(reused.subtitle, LIMITS.slideSubtitle),
        bullets: linkAsBullet ? [bounded(t.link, LIMITS.bullet), ...own] : own,
        notes: truncateText(`${timing(i)} ${linkInNotes ? `${t.link}. ` : ""}${spoken}`, LIMITS.notes),
      };
    }

    let title = section.slides > 1 ? `${sectionTitle} (${p.index + 1}/${section.slides})` : sectionTitle;
    let subtitle = "";
    let bullets: string[] = [];

    switch (kind) {
      case "intro":
        if (p.index === 0) {
          // L'accroche générique ne sert que si la consigne de la section ne dit rien.
          bullets = guidance.length === 0 ? [t.hook] : [];
          if (theme.description) bullets.push(`${t.frame}${colon}${clean(theme.description)}`);
          if (problem) bullets.push(`${t.posedProblem}${colon}${problem}`);
          const terms = problem && problemTerms.length > 0 ? problemTerms : keywords.slice(0, 4);
          if (terms.length > 0) bullets.push(...packList(problem && problemTerms.length > 0 ? t.problemTerms : t.keyTerms, terms, colon).slice(0, 1));
          title = sectionTitle;
        }
        bullets.push(...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      case "problem":
        if (p.index === 0) {
          bullets = problem ? [problem, t.stake, t.tension] : [t.formulate(clean(theme.name)), t.stake, t.tension];
          if (problem) subtitle = clean(theme.name);
          title = sectionTitle;
        }
        bullets.push(...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      case "plan":
        if (p.index === 0) {
          bullets = groups.length > 0 ? groups.map((titles, g) => t.planPart(g + 1, titles)) : [t.planEmpty];
          if (problem) subtitle = problem;
          title = sectionTitle;
        }
        bullets.push(...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      case "conclusion": {
        const last = p.index === section.slides - 1;
        if (last) {
          bullets = problem ? [t.answerTo(problem), t.answer] : [t.answer];
          if (groups.length > 0) bullets.push(t.synthesis(groups.join(" ; ")));
          bullets.push(t.opening);
          title = sectionTitle;
        }
        bullets.push(...guidance.map((g) => todo(t, colon, g)), ...leads);
        break;
      }
      case "part":
        if (p.layout === "section") {
          title = sectionTitle;
          subtitle = clean(section.guidance);
          bullets = [t.opener];
          if (problem) bullets.push(t.link);
        } else if (p.layout === "two-columns" && p.columns) {
          const [left, right] = p.columns;
          title = `${sectionTitle}${colon}${lowerFirst(left)} ${t.and} ${lowerFirst(right)}`;
          // Puces paires : splitColumns met la première moitié à gauche, la seconde à droite.
          bullets = [t.column(left), t.columnExample, t.column(right), t.columnExample];
          subtitle = assigned.length > 0 ? `${t.leads}${colon}${assigned.join(", ")}` : clean(section.guidance);
        } else {
          if (assigned.length > 0) title = `${sectionTitle}${colon}${capitalize(assigned[0])}`;
          bullets = [...leads, ...guidance.map((g) => todo(t, colon, g))];
          if (problem) bullets.push(t.link);
          bullets.push(t.example, t.figure);
        }
        break;
    }

    return {
      layout: p.layout,
      sectionId: section.id,
      title: bounded(title, LIMITS.slideTitle),
      subtitle: bounded(subtitle, LIMITS.slideSubtitle),
      bullets: bullets.map((b) => bounded(b, LIMITS.bullet)).filter((b) => b.length > 0).slice(0, LIMITS.bullets),
      notes: notes(t.notesKind[kind]),
    };
  });

  return DeckSpecSchema.parse({
    title: bounded(problem || theme.name, LIMITS.deckTitle),
    subtitle: cover.subtitle,
    slides: [cover, ...slides],
  });
}

/** Squelette générique d'un thème : une trame conforme au gabarit, sans problématique. */
export function buildFreeSkeleton(ctx: ProgramContext, theme: ThemeRef): DeckSpec {
  return buildDeck({ ctx, theme, problem: null, base: null });
}

/**
 * Deck du jour J : la problématique en titre, posée en introduction, rappelée
 * en conclusion. Si le squelette fourni est conforme au gabarit, ses diapos de
 * développement sont reprises (minutage recalculé) ; sinon tout est généré.
 */
export function buildFreeFinalDeck(ctx: ProgramContext, theme: ThemeRef, skeleton: DeckSpec | null, problem: string): DeckSpec {
  const base = skeleton && checkDeckAgainstTemplate(skeleton, ctx.template).length === 0 ? skeleton : null;
  return buildDeck({ ctx, theme, problem: cleanProblem(problem) || null, base });
}
