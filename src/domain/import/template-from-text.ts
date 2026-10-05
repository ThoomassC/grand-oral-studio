import { deaccent } from "../free/text";
import {
  LIMITS,
  MAX_TEMPLATE_SLIDES,
  PromptTemplateSchema,
  stripControlChars,
  type PromptTemplate,
  type Section,
} from "../schemas";
import { formatSeconds, parseDurationText } from "../slides";

/**
 * Trame préremplie à partir d'un texte libre (consignes d'oral, prompt), lue
 * SANS IA : heuristiques FR/EN déterministes ; lit aussi les prompts Markdown
 * structurés (tableau de diapos avec plages « 2-3 » et colonne Durée, blocs
 * « Entrées », « Règles de contenu »).
 *
 * Renvoie TOUJOURS une trame valide (PromptTemplateSchema, durées comprises),
 * `found` (libellés de ce qui a été repris), `recognized` (champs repris du
 * texte ; les autres gardent la valeur de base) et `warnings` : tout ce qui a
 * été écarté, coupé ou ignoré est signalé — jamais de coupe silencieuse.
 */

const BOUNDS = {
  minDuration: 3,
  maxDuration: 90,
  maxSections: LIMITS.maxSections,
  maxSlidesPerSection: LIMITS.maxSlidesPerSection,
  sectionTitle: 80,
  guidance: 600,
  tone: 200,
  constraints: 2000,
  /** Cellule de durée citée dans un avertissement. */
  durationCell: 40,
} as const;

/** Couverture ajoutée par l'application : 30 s au plus (cf. `templateTimings`). */
const APP_COVER_SECONDS = 30;

export const RECOGNIZED_FIELDS = [
  "durationMinutes",
  "format",
  "language",
  "sections",
  "tone",
  "constraints",
] as const satisfies readonly (keyof PromptTemplate)[];
export type RecognizedField = (typeof RECOGNIZED_FIELDS)[number];

export interface TemplateImport {
  template: PromptTemplate;
  found: string[];
  /** Champs effectivement trouvés dans le texte ; les autres sont ceux de la trame de base. */
  recognized: RecognizedField[];
  /** Ce qui a été écarté, tronqué ou ignoré, en français, affichable tel quel. */
  warnings: string[];
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clean(value: string, max: number): string {
  const s = stripControlChars(value).replace(/[ \t]+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

/** Forme de comparaison : minuscules, sans accents, ponctuation réduite à des espaces. */
function flat(value: string): string {
  return deaccent(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(title: string): string {
  return deaccent(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function quoteList(titles: readonly string[], max = 8): string {
  const shown = titles.slice(0, max).map((t) => `« ${t} »`);
  return titles.length > max ? `${shown.join(", ")}…` : shown.join(", ");
}

/** Retire la syntaxe Markdown en ligne : titres, citations, puces, gras, italique, code, liens. */
export function stripMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}*])\*(?!\s)([^*\n]+?)\*(?![\p{L}\p{N}*])/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface DraftSection {
  title: string;
  guidance: string;
  slides: number;
  /** Cellule de la colonne « Durée » d'un tableau de diapos, telle qu'écrite ("" si absente). */
  duration?: string;
}

interface BoundedSections {
  sections: Section[];
  warnings: string[];
  /** Contenus des lignes « Couverture » écartées (la couverture est ajoutée par l'application). */
  coverGuidance: string[];
  /** Durée lue sur la ligne de couverture écartée, en secondes ; null si aucune. */
  coverSeconds: number | null;
}

/** Durée d'une cellule de tableau → secondes dans les bornes d'une ligne de trame, ou la raison du refus. */
function readCellDuration(cell: string): { seconds: number } | { problem: "illisible" | "hors limites" } {
  const seconds = parseDurationText(cell);
  if (seconds === null) return { problem: "illisible" };
  if (seconds < LIMITS.minSectionSeconds || seconds > LIMITS.maxSectionSeconds) return { problem: "hors limites" };
  return { seconds };
}

const COVER_TITLE =
  /^(?:\d+\s+)?(?:titre|couverture|page (?:de )?(?:garde|titre|couverture)|diapo(?:sitive)? (?:de )?(?:titre|couverture)|cover(?: slide| page)?|title(?: slide| page)?)$/;
const CLOSING_TITLE = /\b(?:conclusion|conclure|ouverture|synthese|bilan|perspectives?|closing|wrap|outlook)\b/;

/**
 * Lignes bornées : la couverture est écartée (l'application l'ajoute), 30
 * lignes au plus (au-delà, la FIN du plan est gardée et le milieu coupé),
 * 1..8 diapos chacune, 59 au total (+ couverture = 60), ids uniques, durée
 * lue dans les bornes d'une ligne (10 s à 90 min). Chaque écart produit un
 * avertissement.
 */
function boundSections(drafts: DraftSection[]): BoundedSections {
  const warnings: string[] = [];
  const coverGuidance: string[] = [];
  let kept = drafts
    .map((d) => ({
      title: clean(stripMarkdown(d.title), BOUNDS.sectionTitle),
      guidance: clean(stripMarkdown(d.guidance), BOUNDS.guidance),
      requested: Math.round(Number.isFinite(d.slides) ? d.slides : 1),
      duration: clean(d.duration ?? "", BOUNDS.durationCell),
    }))
    .filter((d) => d.title.length > 0);

  const covers = kept.filter((d) => COVER_TITLE.test(flat(d.title)));
  let coverSeconds: number | null = null;
  if (covers.length > 0) {
    kept = kept.filter((d) => !covers.includes(d));
    coverGuidance.push(...covers.map((c) => c.guidance).filter(Boolean));
    // Sa durée ne fait pas une ligne de la trame, mais compte dans celle de l'oral.
    for (const c of covers) {
      const read = c.duration ? readCellDuration(c.duration) : null;
      if (coverSeconds === null && read && "seconds" in read) coverSeconds = read.seconds;
    }
    warnings.push(
      `Ligne ${quoteList(covers.map((c) => c.title))} non reprise : l'application ajoute déjà la couverture en tête du deck` +
        (coverGuidance.length > 0 ? " (son contenu est repris dans les contraintes)." : "."),
    );
  }

  if (kept.length > BOUNDS.maxSections) {
    const n = kept.length;
    const closing = kept.findIndex((d, i) => i >= n - Math.floor(BOUNDS.maxSections / 2) && CLOSING_TITLE.test(flat(d.title)));
    const tailLength = closing >= 0 ? n - closing : Math.min(2, n);
    const headLength = BOUNDS.maxSections - tailLength;
    const dropped = kept.slice(headLength, n - tailLength);
    kept = [...kept.slice(0, headLength), ...kept.slice(n - tailLength)];
    warnings.push(
      `La trame compte au plus ${BOUNDS.maxSections} lignes : ${dropped.length} ${dropped.length > 1 ? "lignes non reprises" : "ligne non reprise"} ` +
        `(${quoteList(dropped.map((d) => d.title))}). La fin du plan est conservée ; fusionnez des lignes si besoin.`,
    );
  }

  const sized = kept.map((d) => {
    const slides = clamp(d.requested, 1, BOUNDS.maxSlidesPerSection);
    if (d.requested > BOUNDS.maxSlidesPerSection) {
      warnings.push(
        `« ${d.title} » : ${d.requested} diapos demandées, ramenées à ${BOUNDS.maxSlidesPerSection} (maximum par ligne) ; scindez la ligne si besoin.`,
      );
    }
    let seconds: number | undefined;
    if (d.duration) {
      const read = readCellDuration(d.duration);
      if ("seconds" in read) seconds = read.seconds;
      else if (read.problem === "illisible") {
        warnings.push(`Durée « ${d.duration} » illisible pour « ${d.title} » : calculée automatiquement.`);
      } else {
        warnings.push(`Durée « ${d.duration} » hors limites pour « ${d.title} » (10 s à 90 min) : calculée automatiquement.`);
      }
    }
    return { title: d.title, guidance: d.guidance, slides, initial: slides, seconds };
  });

  const budget = MAX_TEMPLATE_SLIDES - 1;
  let total = sized.reduce((s, d) => s + d.slides, 0);
  if (total > budget) {
    while (total > budget) {
      const largest = sized.reduce((a, b) => (b.slides > a.slides ? b : a));
      largest.slides -= 1;
      total -= 1;
    }
    const changed = sized.filter((d) => d.slides !== d.initial).map((d) => `${d.title} ${d.initial} → ${d.slides}`);
    warnings.push(`Total ramené à ${MAX_TEMPLATE_SLIDES} diapos (couverture comprise) : ${quoteList(changed)}.`);
  }

  const used = new Set<string>();
  const sections = sized.map((d, i) => {
    const root = slugify(d.title) || `section-${i + 1}`;
    let id = root;
    for (let n = 2; used.has(id); n += 1) id = `${root}-${n}`;
    used.add(id);
    const section: Section = { id: id.slice(0, LIMITS.sectionId), title: d.title, guidance: d.guidance, slides: d.slides };
    return d.seconds === undefined ? section : { ...section, seconds: d.seconds };
  });
  return { sections, warnings, coverGuidance, coverSeconds };
}

/** La ligne sans sa durée (calculée automatiquement). Pas de clé `seconds: undefined`. */
function withoutSeconds(section: Section): Section {
  const copy = { ...section };
  delete copy.seconds;
  return copy;
}

/** Durée de la couverture selon l'application (même calcul que `templateTimings`). */
function appCoverSeconds(durationMinutes: number, sections: readonly Section[]): number {
  const total = durationMinutes * 60;
  return Math.min(APP_COVER_SECONDS, total / (1 + sections.reduce((sum, s) => sum + s.slides, 0)));
}

function languageLabel(lang: "fr" | "en"): string {
  return lang === "en" ? "anglais" : "français";
}

/**
 * `inherited` : champs du patch qui ne viennent pas du texte (lignes de la base
 * dont seules les durées ont été retirées) — jamais annoncés comme reconnus.
 */
function finish(
  base: PromptTemplate,
  patch: Partial<PromptTemplate>,
  found: string[],
  warnings: string[],
  inherited: ReadonlySet<RecognizedField> = new Set(),
): TemplateImport {
  const candidate = { ...base, ...patch };
  const checked = PromptTemplateSchema.safeParse(candidate);
  const recognized = RECOGNIZED_FIELDS.filter((f) => patch[f] !== undefined && !inherited.has(f));
  // Défense en profondeur : les bornes ci-dessus rendent l'échec impossible ; sinon, la base intacte.
  return checked.success
    ? { template: checked.data, found, recognized, warnings }
    : { template: base, found: [], recognized: [], warnings };
}

// ---------------------------------------------------------------------------
// Durée, format, ton
// ---------------------------------------------------------------------------

/** Mot qui rattache une durée à l'oral (ligne aplatie : minuscules, sans accents). */
const DURATION_CONTEXT = /\b(?:oral|orale|oraux|presentation|soutenance|duree|duration|expose|talk|pitch|speech|passage|intervention)\b/;
const HOURS = /(?<![\w:])(\d{1,2})\s*h(?:eures?|ours?|rs?)?\s*(\d{2})?(?![\w:])/gi;
const MINUTES = /(?<![\w:])(\d{1,3})\s*(?:min(?:utes?)?|mn)(?![a-z])/gi;
/** Au-delà, une valeur en heures n'est pas une durée d'oral (« Rendu sous 48 h »). */
const MAX_ORAL_HOURS_IN_MINUTES = 120;
/** Au-delà, une valeur en minutes n'est pas une durée d'oral plausible. */
const MAX_ORAL_MINUTES = 180;

interface DurationHit {
  minutes: number;
  raw: string;
  unit: "h" | "min";
  /** La ligne parle de l'oral (« oral », « présentation », « durée »…). */
  context: boolean;
  /** La ligne ne contient que la durée (« 1h15 »). */
  alone: boolean;
}

interface DurationRead {
  /** Durée retenue, déjà bornée à 3..90 min ; null si le texte n'en fixe aucune. */
  minutes: number | null;
  warnings: string[];
}

/**
 * Durée d'oral lue dans le texte. Seules les lignes de prose comptent (ni code,
 * ni entrées à remplir, ni tableau). Les minutes sont retenues si plausibles ;
 * les heures seulement jusqu'à 2 h et rattachées à l'oral (ou seules sur leur
 * ligne). Une ligne qui parle de l'oral l'emporte sur les autres.
 */
function readDuration(scan: Scan): DurationRead {
  const hits: DurationHit[] = [];
  scan.lines.forEach((line, i) => {
    if (scan.code.has(i) || scan.inputs.has(i) || TABLE_LINE.test(line)) return;
    const context = DURATION_CONTEXT.test(flat(line));
    const found = [
      ...[...line.matchAll(HOURS)].map((m) => ({ m, unit: "h" as const, minutes: Number(m[1]) * 60 + Number(m[2] ?? 0) })),
      ...[...line.matchAll(MINUTES)].map((m) => ({ m, unit: "min" as const, minutes: Number(m[1]) })),
    ].sort((a, b) => (a.m.index ?? 0) - (b.m.index ?? 0));
    for (const { m, unit, minutes } of found) {
      const alone = !/\p{L}/u.test(stripMarkdown(line.replace(m[0], " ")).replace(/\b(?:h|min|mn)\b/gi, ""));
      hits.push({ minutes, raw: m[0].trim(), unit, context, alone });
    }
  });
  const plausible = (h: DurationHit) =>
    h.unit === "min"
      ? h.minutes >= 1 && h.minutes <= MAX_ORAL_MINUTES
      : h.minutes > 0 && h.minutes <= MAX_ORAL_HOURS_IN_MINUTES && (h.context || h.alone);
  const chosen = hits.find((h) => h.context && plausible(h)) ?? hits.find(plausible);
  if (!chosen) {
    const rejected = hits.filter((h) => h.context && h.minutes > 0);
    return {
      minutes: null,
      warnings: rejected.map(
        (h) =>
          `Durée « ${h.raw} » ignorée : un oral dure de ${BOUNDS.minDuration} à ${BOUNDS.maxDuration} min. Saisissez la durée à la main si besoin.`,
      ),
    };
  }
  const minutes = clamp(chosen.minutes, BOUNDS.minDuration, BOUNDS.maxDuration);
  return {
    minutes,
    warnings:
      minutes === chosen.minutes
        ? []
        : [`Durée « ${chosen.raw} » ramenée à ${minutes} min (un oral dure de ${BOUNDS.minDuration} à ${BOUNDS.maxDuration} min).`],
  };
}

/** 16:9 / 4:3, y compris par une résolution (1920×1080, 1024×768). */
function parseFormat(text: string): "16:9" | "4:3" | null {
  if (/\b16\s*[:/x×]\s*9\b|\b(?:1920|1280|3840|2560)\s*[x×]\s*(?:1080|720|2160|1440)\b/.test(text)) return "16:9";
  if (/\b4\s*[:/x×]\s*3\b|\b(?:1024\s*[x×]\s*768|800\s*[x×]\s*600)\b/.test(text)) return "4:3";
  return null;
}

/** « ~40 secondes par diapo » → 40. */
function parsePace(text: string): number | null {
  const m = /(\d{1,3})\s*(?:s|sec|secondes?|seconds?)\b\.?\s*(?:par|per|\/|a|by)\s*(?:diapo|diapositive|slide)/i.exec(text);
  return m ? Number(m[1]) : null;
}

function durationWarning(base: PromptTemplate, totalSlides: number, pace: number | null): string {
  const hint =
    pace !== null && totalSlides > 0
      ? ` À ~${pace} s par diapo, ${totalSlides} diapos représentent environ ${Math.max(1, Math.round((pace * totalSlides) / 60))} min.`
      : "";
  return `Durée non précisée dans le texte : la durée actuelle de la trame (${base.durationMinutes} min) est conservée — vérifiez-la.${hint}`;
}

const TONE_FR: Readonly<Record<string, string>> = {
  formal: "formel",
  informal: "informel",
  professional: "professionnel",
  academic: "académique",
  scholarly: "académique",
  engaging: "engageant",
  dynamic: "dynamique",
  clear: "clair",
  concise: "concis",
  structured: "structuré",
  rigorous: "rigoureux",
  persuasive: "persuasif",
  convincing: "convaincant",
  neutral: "neutre",
  friendly: "cordial",
  pedagogical: "pédagogique",
  educational: "pédagogique",
  didactic: "didactique",
  serious: "sérieux",
  factual: "factuel",
  objective: "objectif",
  argumentative: "argumenté",
  argued: "argumenté",
  confident: "assuré",
  calm: "posé",
  enthusiastic: "enthousiaste",
  inspiring: "inspirant",
  analytical: "analytique",
  critical: "critique",
  precise: "précis",
  sober: "sobre",
  technical: "technique",
};
const ENGLISH_WORD = /\b(?:the|with|and|of|to|for|an?|tone|style|audience|yet|but|while)\b/i;
const FRENCH_WORD = /\b(?:et|le|la|les|des|du|de|avec|pour|un|une|mais|ton)\b|[àâçéèêëîïôûùüÿœ]/i;

/**
 * Ton dans la langue du deck : un ton anglais (« Formal ») est traduit pour un
 * deck français s'il est connu, sinon écarté (""). Un ton déjà français ou un
 * deck anglais : inchangé.
 */
export function normalizeTone(tone: string, lang: "fr" | "en"): string {
  const value = clean(tone, BOUNDS.tone).replace(/[\s.;]+$/, "");
  if (!value || lang === "en") return value;
  const parts = value.split(/\s*(?:,|;|\/|&|\band\b)\s*/i).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const translated = parts.map((p) => TONE_FR[p]);
  if (parts.length > 0 && translated.every((t): t is string => typeof t === "string")) return translated.join(", ");
  if (ENGLISH_WORD.test(value) && !FRENCH_WORD.test(value)) return "";
  return value;
}

/** Valeur de remplissage d'un modèle (« … », « [à remplir] ») : pas une vraie valeur. */
function isPlaceholder(value: string): boolean {
  return /^[\s.…_\-–—[\]()]*$/.test(value) || /^\[?\s*(?:a remplir|à remplir|to fill|tbd|xx+)\s*\]?$/i.test(value);
}

// ---------------------------------------------------------------------------
// Découpage des lignes
// ---------------------------------------------------------------------------

const SLIDES_PATTERN = /\(?\s*(\d{1,2})\s*(?:diapositives?|diapos?|slides?)\s*\)?/i;
/** Début de ligne « - **Clé** : », « **Clé :** », « * Clé : » (puce et gras facultatifs). */
const META_LEAD = String.raw`^\s*(?:[-•]\s*|\*\s+)?(?:\*\*|__)?`;
const META_COLON = String.raw`\s*(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*`;
const METADATA_LINE = new RegExp(`${META_LEAD}(dur[ée]e|duration|format|langue|language|ton|tone)${META_COLON}`, "i");
const TONE_LINE = new RegExp(`${META_LEAD}(?:ton|tone)${META_COLON}(.+)$`, "i");
const LANGUAGE_LINE = new RegExp(`${META_LEAD}(?:langue|language)${META_COLON}(.+)$`, "im");
const NUMBERED = /^\s*(\d{1,2})\s*[.)\-–:]\s+(.+)$/;
const BULLET = /^\s*[-*•–]\s+(.+)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const TABLE_LINE = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*(?:```|~~~)/;
const RULE_LINE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

function parseLanguage(text: string): "fr" | "en" | null {
  const line = LANGUAGE_LINE.exec(text)?.[1]?.replace(/[*_`]/g, "").trim().toLowerCase();
  const value = line ? deaccent(line) : null;
  if (value) {
    if (/^(en|anglais|english)\b/.test(value)) return "en";
    if (/^(fr|francais|french)\b/.test(value)) return "fr";
  }
  const t = deaccent(text.toLowerCase());
  if (/\b(en anglais|in english)\b/.test(t)) return "en";
  if (/\b(en francais|in french)\b/.test(t)) return "fr";
  return null;
}

const LIST_HEADER = /^\s*(?:sections?|plan|structure)\s*[:：]?\s*$/i;
const INLINE_KEYWORD =
  /(?<=[.;!?])\s+(?=(?:dur[ée]e|duration|format|langue|language|ton|tone|sections?|plan|structure|contraintes?|constraints?)\s*[:：])/giu;
const INLINE_MARKER = /(^|\s)(\d{1,2})[.)]\s+(?=\p{L})/gu;

/** Numéros « 1. … 2. … » d'une même ligne : coupés seulement s'il y en a au moins deux, dans l'ordre. */
function splitNumberedLine(line: string): string {
  let sequential = 1;
  for (const m of line.matchAll(INLINE_MARKER)) if (Number(m[2]) === sequential) sequential += 1;
  if (sequential <= 2) return line;
  let expected = 1;
  return line.replace(INLINE_MARKER, (match: string, lead: string, num: string) => {
    if (Number(num) !== expected) return match;
    expected += 1;
    return `${lead ? "\n" : ""}${num}. `;
  });
}

/**
 * Prompt collé sur une seule ligne (« Sections : 1. Intro (1 diapo) 2. … Ton : … ») :
 * remet une consigne par ligne. Un numéro n'ouvre une ligne que s'il prolonge la
 * suite 1, 2, 3… sur la même ligne : « 1 h 30. », « 16:9. » ou un titre
 * Markdown « ## 1. Architecture » ne sont pas coupés.
 */
function splitInlineInstructions(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    if (HEADING.test(line) || TABLE_LINE.test(line)) return [line];
    return line.replace(INLINE_KEYWORD, "\n").split("\n").map(splitNumberedLine).join("\n").split("\n");
  });
}

/** « Analyse : forces et faiblesses (3 diapos) » → titre, consigne, diapos. */
function parseItem(raw: string): DraftSection {
  const slidesMatch = SLIDES_PATTERN.exec(raw);
  const slides = slidesMatch ? Number(slidesMatch[1]) : 1;
  const rest = (slidesMatch ? raw.replace(slidesMatch[0], " ") : raw).replace(/[\s:—–.;-]+$/, "").trim();
  const split = /\s*(?:[:：]|\s[—–-])\s+/.exec(rest);
  const title = split ? rest.slice(0, split.index) : rest;
  const guidance = split ? rest.slice(split.index + split[0].length) : "";
  return { title: title.replace(/[*_`]/g, "").trim(), guidance: guidance.trim(), slides };
}

// ---------------------------------------------------------------------------
// Structure Markdown : blocs de titres, tableaux
// ---------------------------------------------------------------------------

type BlockRole = "title" | "inputs" | "rules" | "meta" | "plain";

interface Block {
  /** Index de la ligne de titre, -1 pour le préambule. */
  heading: number;
  level: number;
  title: string;
  role: BlockRole;
  start: number;
  end: number;
}

const INPUTS_TITLE = /\b(?:entrees?|inputs?|variables?|parametres?|a remplir|to fill(?: in)?|placeholders?)\b/;
const RULES_TITLE = /\b(?:regles?|contraintes?|exigences?|criteres?|attendus|rules|constraints|requirements)\b/;
const META_TITLE = /^(?:ta |votre |your )?(?:mission|tache|task|objectif|objective|role)\b/;

function headingTitle(line: string): string {
  return stripMarkdown(HEADING.exec(line)?.[2] ?? "");
}

/** Titre sans numéro de rubrique (« 2. Règles de contenu » → « regles de contenu »). */
function headingKey(title: string): string {
  return flat(title.replace(/^\s*\d{1,2}\s*[.)\-–:]\s*/, ""));
}

function buildBlocks(lines: readonly string[], code: ReadonlySet<number>): Block[] {
  const headings = lines.flatMap((l, i) => (!code.has(i) && HEADING.test(l) ? [i] : []));
  const levelOf = (i: number) => HEADING.exec(lines[i] ?? "")?.[1]?.length ?? 6;
  const first = headings[0];
  const others = headings.slice(1).map(levelOf);
  const documentTitle = first !== undefined && others.length >= 2 && others.every((lv) => lv > levelOf(first)) ? first : undefined;
  const blocks: Block[] = [{ heading: -1, level: 0, title: "", role: "plain", start: 0, end: headings[0] ?? lines.length }];
  headings.forEach((h, k) => {
    const title = headingTitle(lines[h] ?? "");
    const key = headingKey(title);
    const role: BlockRole =
      h === documentTitle ? "title" : INPUTS_TITLE.test(key) ? "inputs" : RULES_TITLE.test(key) ? "rules" : META_TITLE.test(key) ? "meta" : "plain";
    blocks.push({ heading: h, level: levelOf(h), title, role, start: h + 1, end: headings[k + 1] ?? lines.length });
  });
  return blocks;
}

function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => stripMarkdown(c.replace(/\\\|/g, "|")));
}

interface Table {
  start: number;
  end: number;
  header: string[];
  rows: string[][];
}

function findTables(lines: readonly string[], code: ReadonlySet<number>): Table[] {
  const tables: Table[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (code.has(i) || !TABLE_LINE.test(lines[i] ?? "") || !TABLE_SEPARATOR.test(lines[i + 1] ?? "")) continue;
    let end = i + 2;
    while (end < lines.length && !code.has(end) && TABLE_LINE.test(lines[end] ?? "")) end += 1;
    tables.push({ start: i, end, header: tableCells(lines[i] ?? ""), rows: lines.slice(i + 2, end).map(tableCells) });
    i = end - 1;
  }
  return tables;
}

const SLIDE_NUMBER = /^(\d{1,2})(?:\s*(?:-|–|—|à|to|a)\s*(\d{1,2}))?$/;
/** En-tête aplati d'une colonne de durées (« Durée », « Temps », « Minutage »…). */
const DURATION_HEADER = /\b(?:durees?|temps|timing|minutage|duration|time)\b/;
const NUMBER_HEADER = /^(?:#|n°|no|num(?:ero)?|nb|n)$/;
const TITLE_HEADER = /\b(?:diapos?|diapositives?|slides?|titre|title|sections?|parties?|etapes?|sequences?)\b/;
const ROLE_HEADER = /\b(?:roles?|objectifs?|consignes?|contenus?|descriptions?|buts?|guidance|purpose|content|notes?|attendus?)\b/;

/**
 * Tableau de diapos : une colonne de numéros (« 1 », « 9-12 ») sur la plupart
 * des lignes, une colonne de titre et, si elles existent, une colonne de
 * contenu et une colonne de durée (« 3:30 »). Chaque ligne devient une ligne de
 * trame ; une plage « 9-12 » vaut 4 diapos.
 */
function slidesFromTable(table: Table): { drafts: DraftSection[]; warnings: string[] } | null {
  if (table.rows.length < 2) return null;
  const width = table.header.length;
  const all = Array.from({ length: width }, (_, c) => c);
  const durationCol = all.find((c) => DURATION_HEADER.test(flat(table.header[c] ?? "")));
  const numericShare = (c: number) =>
    table.rows.filter((r) => SLIDE_NUMBER.test((r[c] ?? "").trim())).length / table.rows.length;
  const headerKeys = table.header.map((h) => h.trim().toLowerCase());
  let numCol = headerKeys.findIndex((h) => NUMBER_HEADER.test(h));
  if (numCol < 0 || numericShare(numCol) < 0.6) {
    numCol = all.find((c) => c !== durationCol && numericShare(c) >= 0.6) ?? -1;
  }
  if (numCol < 0) return null;
  // La colonne des durées n'est jamais un titre ni un contenu.
  const columns = all.filter((c) => c !== numCol && c !== durationCol);
  const titleCol = columns.find((c) => TITLE_HEADER.test(flat(table.header[c] ?? ""))) ?? columns[0];
  if (titleCol === undefined) return null;
  const roleCol =
    columns.find((c) => c !== titleCol && ROLE_HEADER.test(flat(table.header[c] ?? ""))) ?? columns.find((c) => c !== titleCol);
  const drafts: DraftSection[] = [];
  const warnings: string[] = [];
  table.rows.forEach((row, r) => {
    const title = (row[titleCol] ?? "").trim();
    const number = (row[numCol] ?? "").trim();
    if (!title) {
      const rest = row.map((c) => c.trim()).filter(Boolean);
      if (rest.length > 0) warnings.push(`Tableau : ligne ${r + 1} sans titre ignorée (${quoteList(rest, 3)}).`);
      return;
    }
    const m = SLIDE_NUMBER.exec(number);
    const a = m ? Number(m[1]) : 0;
    const b = m?.[2] ? Number(m[2]) : a;
    const [from, to] = a <= b ? [a, b] : [b, a];
    const slides = m ? to - from + 1 : 1;
    if (!m && number) warnings.push(`Tableau : numéro « ${number} » illisible pour « ${title} », compté pour 1 diapo.`);
    else if (m && a > b) warnings.push(`Tableau : plage « ${number} » inversée pour « ${title} », lue comme ${from}-${to} (${slides} diapos).`);
    if (m && from === 0) warnings.push(`Tableau : numéro « 0 » pour « ${title} » (les diapos sont numérotées à partir de 1), compté pour ${slides} diapo${slides > 1 ? "s" : ""}.`);
    drafts.push({
      title,
      guidance: roleCol === undefined ? "" : (row[roleCol] ?? "").trim(),
      slides,
      duration: durationCol === undefined ? "" : (row[durationCol] ?? "").trim(),
    });
  });
  return drafts.length >= 2 ? { drafts, warnings } : null;
}

const PLAN_TITLE = /^(?:le |notre |votre |your |the )?(?:plan|structure|sommaire|deroule|deroulement|outline|agenda|table des matieres)\b/;

/**
 * Liste (numérotée, sinon à puces) d'au moins deux items sous un titre de type
 * plan / structure / sommaire / déroulé : ce sont les sections du deck.
 */
function findPlanList(blocks: readonly Block[], lines: readonly string[], code: ReadonlySet<number>) {
  for (const block of blocks) {
    if (block.heading < 0 || block.role !== "plain" || !PLAN_TITLE.test(headingKey(block.title))) continue;
    const indices = Array.from({ length: block.end - block.start }, (_, k) => block.start + k).filter((i) => !code.has(i));
    for (const pattern of [NUMBERED, BULLET]) {
      const items = indices.filter((i) => pattern.test(lines[i] ?? ""));
      if (items.length >= 2) return { block, items, pattern };
    }
  }
  return undefined;
}

/** Paragraphes d'un bloc : lignes consécutives réunies, une puce ou un numéro ouvre un paragraphe. */
function paragraphs(lines: readonly string[], indices: readonly number[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let previous = -2;
  const flush = () => {
    if (current.length > 0) out.push(current.join(" ").replace(/\s+/g, " ").trim());
    current = [];
  };
  for (const i of indices) {
    const raw = lines[i] ?? "";
    const opensItem = /^\s*(?:[-*+•]|\d{1,2}[.)])\s+/.test(raw);
    if (i !== previous + 1 || opensItem) flush();
    const text = stripMarkdown(raw);
    if (text) current.push(text);
    previous = i;
  }
  flush();
  return out.filter(Boolean);
}

/**
 * Contraintes d'un prompt structuré, 2 000 caractères au plus : consigne de
 * couverture, blocs de règles, bloc du tableau de diapos, autres blocs, puis
 * mission / titre. Les entrées à remplir et les blocs de code sont exclus ; un
 * bloc qui ne tient pas (en tout ou partie) est listé dans `omitted`.
 */
function structuredConstraints(
  blocks: readonly Block[],
  lines: readonly string[],
  usable: (i: number) => boolean,
  tableBlock: Block | undefined,
  lead: readonly string[],
): { text: string; omitted: string[] } {
  const rank = (b: Block) => (b.role === "rules" ? 0 : b === tableBlock ? 1 : b.role === "plain" ? 2 : 3);
  const ordered = blocks
    .filter((b) => b.role !== "inputs")
    .map((b, order) => ({ b, order }))
    .sort((x, y) => rank(x.b) - rank(y.b) || x.order - y.order)
    .map((x) => x.b);
  const picked = new Map<Block, string[]>();
  const omitted: string[] = [];
  let length = lead.join("\n").length;
  for (const block of ordered) {
    const indices = Array.from({ length: block.end - block.start }, (_, k) => block.start + k).filter(usable);
    const kept: string[] = [];
    let missing = false;
    for (const p of paragraphs(lines, indices)) {
      const cost = p.length + (length > 0 ? 1 : 0);
      if (length + cost > BOUNDS.constraints) {
        missing = true;
        continue;
      }
      kept.push(p);
      length += cost;
    }
    if (missing) omitted.push(block.title || "Introduction du prompt");
    picked.set(block, kept);
  }
  // Ordre d'affichage : celui du document (la priorité ne sert qu'au remplissage).
  const body = blocks.flatMap((b) => picked.get(b) ?? []);
  return { text: [...lead, ...body].join("\n"), omitted };
}

interface Scan {
  lines: string[];
  /** Lignes des blocs de code (``` … ```). */
  code: Set<number>;
  blocks: Block[];
  /** Lignes des blocs d'entrées à remplir. */
  inputs: Set<number>;
}

/** Lignes à ne jamais lire comme un tableau de diapos : entrées à remplir, titres de blocs. */
function ignoredLines(scan: Scan): Set<number> {
  const ignored = new Set<number>(scan.inputs);
  for (const b of scan.blocks) if (b.heading >= 0) ignored.add(b.heading);
  return ignored;
}

/** Le tableau de diapos du texte (celui qui a le plus de lignes exploitables), s'il y en a un. */
function findSlideTable(scan: Scan, ignored: ReadonlySet<number> = ignoredLines(scan)) {
  return findTables(scan.lines, scan.code)
    .map((t) => ({ t, drafts: slidesFromTable(t) }))
    .filter((x): x is { t: Table; drafts: NonNullable<ReturnType<typeof slidesFromTable>> } => x.drafts !== null && !ignored.has(x.t.start))
    .sort((a, b) => b.drafts.drafts.length - a.drafts.drafts.length)[0];
}

/** Découpe le texte en lignes et repère blocs de code, blocs Markdown et entrées à remplir. */
function scanText(text: string): Scan {
  const lines = splitInlineInstructions(stripControlChars(text).replace(/\r\n?/g, "\n"));
  const code = new Set<number>();
  let inFence = false;
  lines.forEach((l, i) => {
    if (FENCE.test(l)) {
      code.add(i);
      inFence = !inFence;
    } else if (inFence) code.add(i);
  });
  const blocks = buildBlocks(lines, code);
  const inputs = new Set<number>();
  for (const b of blocks) if (b.role === "inputs") for (let i = b.start; i < b.end; i += 1) inputs.add(i);
  return { lines, code, blocks, inputs };
}

export function parseTemplateText(text: string, base: PromptTemplate): TemplateImport {
  const found: string[] = [];
  const warnings: string[] = [];
  const patch: Partial<PromptTemplate> = {};
  const source = stripControlChars(text).replace(/\r\n?/g, "\n");
  const scan = scanText(source);
  // Blocs de code (``` … ```) : jamais des sections ni des contraintes.
  const { lines, code, blocks } = scan;
  const blockOf = (i: number) => blocks.find((b) => i >= b.start && i < b.end) ?? blocks[0];
  const ignored = ignoredLines(scan);

  const duration = readDuration(scan);
  warnings.push(...duration.warnings);
  if (duration.minutes !== null) {
    patch.durationMinutes = duration.minutes;
    found.push(`Durée : ${duration.minutes} min`);
  }
  const format = parseFormat(source);
  if (format) {
    patch.format = format;
    found.push(`Format : ${format}`);
  }
  const language = parseLanguage(source);
  if (language) {
    patch.language = language;
    found.push(`Langue : ${languageLabel(language)}`);
  }
  const consumed = new Set<number>();
  let rawTone = "";
  lines.forEach((line, i) => {
    if (code.has(i) || scan.inputs.has(i)) return;
    const tone = TONE_LINE.exec(line);
    const value = tone?.[1] ? stripMarkdown(tone[1]).replace(/[\s.;]+$/, "") : "";
    if (value && !isPlaceholder(value)) rawTone = clean(value, BOUNDS.tone);
    if (METADATA_LINE.test(line) || LIST_HEADER.test(line) || RULE_LINE.test(line)) consumed.add(i);
  });
  if (rawTone) {
    // Le ton est rédigé dans la langue du deck (un ton anglais est traduit ou écarté).
    const tone = normalizeTone(rawTone, language ?? base.language);
    if (tone) {
      patch.tone = tone;
      found.push("Ton");
    } else {
      warnings.push(`Ton « ${rawTone} » non repris : il n'est pas rédigé en français.`);
    }
  }

  // Sections : tableau de diapos, sinon titres Markdown (au moins 2), sinon liste numérotée, sinon puces.
  const drafts: DraftSection[] = [];
  let tableBlock: Block | undefined;
  const best = findSlideTable(scan, ignored);
  const sectionHeadings = blocks.filter((b) => b.heading >= 0 && b.role === "plain");
  const structured = best !== undefined || blocks.length > 2;
  const plan = best ? undefined : findPlanList(blocks, lines, code);
  if (best) {
    drafts.push(...best.drafts.drafts);
    warnings.push(...best.drafts.warnings);
    for (let i = best.t.start; i < best.t.end; i += 1) consumed.add(i);
    tableBlock = blockOf(best.t.start);
  } else if (plan) {
    for (const i of plan.items) {
      const m = plan.pattern.exec(lines[i] ?? "");
      drafts.push(parseItem((plan.pattern === NUMBERED ? m?.[2] : m?.[1]) ?? ""));
      consumed.add(i);
    }
    tableBlock = plan.block;
  } else if (sectionHeadings.length >= 2) {
    for (const b of sectionHeadings) {
      const body: string[] = [];
      for (let i = b.start; i < b.end; i += 1) {
        if (consumed.has(i) || code.has(i)) continue;
        const l = stripMarkdown(lines[i] ?? "");
        if (l) body.push(l);
        consumed.add(i);
      }
      consumed.add(b.heading);
      const item = parseItem(b.title.replace(/^\s*\d{1,2}\s*[.)]\s+/, ""));
      drafts.push({ ...item, guidance: [item.guidance, ...body].filter(Boolean).join(" ") });
    }
  } else {
    const free = (i: number) => !consumed.has(i) && !code.has(i) && !ignored.has(i);
    const pattern = lines.filter((l, i) => free(i) && NUMBERED.test(l)).length >= 2 ? NUMBERED : BULLET;
    const items = lines.flatMap((l, i) => (free(i) && pattern.test(l) ? [i] : []));
    if (items.length >= 2) {
      for (const i of items) {
        const m = pattern.exec(lines[i] ?? "");
        const content = pattern === NUMBERED ? m?.[2] : m?.[1];
        drafts.push(parseItem(content ?? ""));
        consumed.add(i);
      }
    }
  }
  const bounded = boundSections(drafts);
  warnings.push(...bounded.warnings);
  if (bounded.sections.length > 0) {
    patch.sections = bounded.sections;
    found.push(`${bounded.sections.length} ${bounded.sections.length > 1 ? "lignes" : "ligne"}`);
  }
  const coverLead = bounded.coverGuidance.map((g) => `Couverture : ${g}`);
  const inherited = new Set<RecognizedField>();
  fitDurations(base, patch, found, warnings, inherited, bounded.coverSeconds);

  const usable = (i: number) => !consumed.has(i) && !code.has(i) && !ignored.has(i) && (lines[i] ?? "").trim() !== "";
  let constraints: string;
  if (structured) {
    const { text: joined, omitted } = structuredConstraints(blocks, lines, usable, tableBlock, coverLead);
    constraints = joined;
    if (omitted.length > 0) {
      warnings.push(
        `Contraintes limitées à ${BOUNDS.constraints.toLocaleString("fr-FR")} caractères : non repris, en tout ou partie — ${quoteList(omitted)}. Complétez à la main si besoin.`,
      );
    }
  } else {
    const rest = [...coverLead, ...lines.filter((_, i) => usable(i)).map((l) => l.trim())].join("\n");
    if (rest.length > BOUNDS.constraints) {
      warnings.push(`Contraintes tronquées à ${BOUNDS.constraints.toLocaleString("fr-FR")} caractères.`);
    }
    constraints = rest;
  }
  if (constraints) {
    patch.constraints = clean(constraints, BOUNDS.constraints);
    found.push("Contraintes");
  }

  if (patch.durationMinutes === undefined && patch.sections && !inherited.has("sections")) {
    warnings.push(durationWarning(base, 1 + patch.sections.reduce((s, d) => s + d.slides, 0), parsePace(source)));
  }
  return finish(base, patch, found, warnings, inherited);
}

/**
 * Durées des lignes et durée de l'oral, rendues cohérentes (le refine de
 * PromptTemplateSchema) :
 *  - sans durée d'oral dans le texte, des lignes TOUTES minutées la donnent :
 *    somme + couverture (celle du tableau, 30 s au moins : la couverture de
 *    l'application), arrondie à la minute supérieure, bornée à 3..90 min ;
 *  - des durées qui ne tiennent pas dans l'oral (couverture de l'application
 *    comprise) sont toutes retirées, avec un avertissement : elles redeviennent
 *    automatiques. Vaut aussi pour les durées de la trame actuelle quand le
 *    texte change seulement la durée de l'oral (`inherited` reçoit alors
 *    « sections » : ces lignes ne viennent pas du texte).
 */
function fitDurations(
  base: PromptTemplate,
  patch: Partial<PromptTemplate>,
  found: string[],
  warnings: string[],
  inherited: Set<RecognizedField>,
  coverSeconds: number | null,
): void {
  const fromText = patch.sections !== undefined;
  const sections = patch.sections ?? base.sections;
  const fixed = sections.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  if (fixed === 0) return;

  if (fromText && patch.durationMinutes === undefined && sections.every((s) => s.seconds !== undefined)) {
    const cover = Math.max(coverSeconds ?? APP_COVER_SECONDS, APP_COVER_SECONDS);
    const minutes = clamp(Math.ceil((fixed + cover) / 60), BOUNDS.minDuration, BOUNDS.maxDuration);
    patch.durationMinutes = minutes;
    found.unshift(`Durée : ${minutes} min (somme des diapos)`);
  }

  const minutes = patch.durationMinutes ?? base.durationMinutes;
  const cover = appCoverSeconds(minutes, sections);
  if (fixed <= minutes * 60 - cover) {
    if (fromText) found.push("Durées des diapos");
    return;
  }
  const label = fromText ? "Durées des diapos ignorées" : "Durées des lignes actuelles ignorées";
  warnings.push(`${label} : leur total (${formatSeconds(fixed + cover)}) dépasse la durée de l'oral (${minutes} min).`);
  patch.sections = sections.map(withoutSeconds);
  if (!fromText) inherited.add("sections");
}
