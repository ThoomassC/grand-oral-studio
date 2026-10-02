import { z } from "zod";
import { deaccent } from "../free/text";
import {
  LIMITS,
  MAX_TEMPLATE_SLIDES,
  PromptTemplateSchema,
  stripControlChars,
  type PromptTemplate,
  type Section,
} from "../schemas";

/**
 * Gabarit prérempli à partir d'un texte libre (consignes d'oral, prompt).
 *
 * `parseTemplateText` : heuristiques FR/EN, sans IA (moteur gratuit).
 * `normalizeTemplateDraft` : ramène une sortie IA permissive dans les bornes.
 * Les deux renvoient TOUJOURS un gabarit valide (PromptTemplateSchema, 60
 * diapos au plus) et `found`, la liste de ce qui a été repris.
 */

const BOUNDS = {
  minDuration: 3,
  maxDuration: 90,
  maxSections: 15,
  maxSlidesPerSection: 8,
  sectionTitle: 80,
  guidance: 600,
  tone: 200,
  constraints: 2000,
} as const;

export interface TemplateImport {
  template: PromptTemplate;
  found: string[];
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clean(value: string, max: number): string {
  const s = stripControlChars(value).replace(/[ \t]+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

function slugify(title: string): string {
  return deaccent(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

interface DraftSection {
  title: string;
  guidance: string;
  slides: number;
}

/** Sections bornées : 15 au plus, 1..8 diapos chacune, 59 au total (+ couverture = 60), ids uniques. */
function boundSections(drafts: DraftSection[]): Section[] {
  const kept = drafts
    .map((d) => ({
      title: clean(d.title, BOUNDS.sectionTitle),
      guidance: clean(d.guidance, BOUNDS.guidance),
      slides: clamp(Math.round(Number.isFinite(d.slides) ? d.slides : 1), 1, BOUNDS.maxSlidesPerSection),
    }))
    .filter((d) => d.title.length > 0)
    .slice(0, BOUNDS.maxSections);
  const budget = MAX_TEMPLATE_SLIDES - 1;
  let total = kept.reduce((s, d) => s + d.slides, 0);
  while (total > budget) {
    const largest = kept.reduce((a, b) => (b.slides > a.slides ? b : a));
    largest.slides -= 1;
    total -= 1;
  }
  const used = new Set<string>();
  return kept.map((d, i) => {
    const root = slugify(d.title) || `section-${i + 1}`;
    let id = root;
    for (let n = 2; used.has(id); n += 1) id = `${root}-${n}`;
    used.add(id);
    return { id: id.slice(0, LIMITS.sectionId), title: d.title, guidance: d.guidance, slides: d.slides };
  });
}

function languageLabel(lang: "fr" | "en"): string {
  return lang === "en" ? "anglais" : "français";
}

function finish(base: PromptTemplate, patch: Partial<PromptTemplate>, found: string[]): TemplateImport {
  const candidate = { ...base, ...patch };
  const checked = PromptTemplateSchema.safeParse(candidate);
  // Défense en profondeur : les bornes ci-dessus rendent l'échec impossible ; sinon, la base intacte.
  return checked.success ? { template: checked.data, found } : { template: base, found: [] };
}

// ---------------------------------------------------------------------------
// Heuristiques (moteur gratuit)
// ---------------------------------------------------------------------------

const SLIDES_PATTERN = /\(?\s*(\d{1,2})\s*(?:diapositives?|diapos?|slides?)\s*\)?/i;
const METADATA_LINE = /^\s*(?:[-*•]\s*)?(dur[ée]e|duration|format|langue|language|ton|tone)\s*[:：]/i;
const NUMBERED = /^\s*(\d{1,2})\s*[.)\-–:]\s+(.+)$/;
const BULLET = /^\s*[-*•–]\s+(.+)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

function parseDuration(text: string): number | null {
  const hours = /(?<![\w:])(\d{1,2})\s*h(?:eures?|ours?|rs?)?\s*(\d{2})?(?![\w:])/i.exec(text);
  if (hours) return Number(hours[1]) * 60 + Number(hours[2] ?? 0);
  const minutes = /(?<![\w:])(\d{1,3})\s*(?:min(?:utes?)?|mn)(?![a-z])/i.exec(text);
  return minutes ? Number(minutes[1]) : null;
}

function parseLanguage(text: string): "fr" | "en" | null {
  const line = /^\s*(?:langue|language)\s*[:：]\s*(.+)$/im.exec(text)?.[1]?.trim().toLowerCase();
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

/**
 * Prompt collé sur une seule ligne (« Sections : 1. Intro (1 diapo) 2. … Ton : … ») :
 * remet une consigne par ligne. Un numéro n'ouvre une ligne que s'il prolonge la
 * suite 1, 2, 3… : « 1 h 30. » ou « 16:9. » ne sont pas coupés.
 */
function splitInlineInstructions(text: string): string {
  const withKeywords = text.replace(INLINE_KEYWORD, "\n");
  let expected = 1;
  return withKeywords.replace(INLINE_MARKER, (match: string, lead: string, num: string) => {
    if (Number(num) !== expected) return match;
    expected += 1;
    return `${lead ? "\n" : ""}${num}. `;
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

export function parseTemplateText(text: string, base: PromptTemplate): TemplateImport {
  const found: string[] = [];
  const patch: Partial<PromptTemplate> = {};
  const lines = splitInlineInstructions(stripControlChars(text)).split(/\r?\n/);
  const consumed = new Set<number>();

  const duration = parseDuration(text);
  if (duration !== null) {
    patch.durationMinutes = clamp(duration, BOUNDS.minDuration, BOUNDS.maxDuration);
    found.push(`Durée : ${patch.durationMinutes} min`);
  }
  const format = /\b16\s*[:/x×]\s*9\b/.test(text) ? "16:9" : /\b4\s*[:/x×]\s*3\b/.test(text) ? "4:3" : null;
  if (format) {
    patch.format = format;
    found.push(`Format : ${format}`);
  }
  const language = parseLanguage(text);
  if (language) {
    patch.language = language;
    found.push(`Langue : ${languageLabel(language)}`);
  }
  lines.forEach((line, i) => {
    const tone = /^\s*(?:[-*•]\s*)?(?:ton|tone)\s*[:：]\s*(.+)$/i.exec(line);
    if (tone?.[1]) {
      patch.tone = clean(tone[1].replace(/[\s.;]+$/, ""), BOUNDS.tone);
      if (!found.includes("Ton")) found.push("Ton");
    }
    if (METADATA_LINE.test(line) || LIST_HEADER.test(line)) consumed.add(i);
  });

  // Sections : titres Markdown (au moins 2), sinon liste numérotée, sinon puces.
  const headings = lines.flatMap((l, i) => (HEADING.test(l) && !consumed.has(i) ? [i] : []));
  const drafts: DraftSection[] = [];
  if (headings.length >= 2) {
    headings.forEach((h, k) => {
      const end = headings[k + 1] ?? lines.length;
      const body: string[] = [];
      for (let i = h + 1; i < end; i += 1) {
        if (consumed.has(i)) continue;
        const l = lines[i]?.trim() ?? "";
        if (l) body.push(l.replace(BULLET, "$1"));
        consumed.add(i);
      }
      consumed.add(h);
      const item = parseItem(HEADING.exec(lines[h] ?? "")?.[1] ?? "");
      drafts.push({ ...item, guidance: [item.guidance, ...body].filter(Boolean).join(" ") });
    });
  } else {
    const pattern = lines.filter((l, i) => !consumed.has(i) && NUMBERED.test(l)).length >= 2 ? NUMBERED : BULLET;
    const items = lines.flatMap((l, i) => (!consumed.has(i) && pattern.test(l) ? [i] : []));
    if (items.length >= 2) {
      for (const i of items) {
        const m = pattern.exec(lines[i] ?? "");
        const content = pattern === NUMBERED ? m?.[2] : m?.[1];
        drafts.push(parseItem(content ?? ""));
        consumed.add(i);
      }
    }
  }
  const sections = boundSections(drafts);
  if (sections.length > 0) {
    patch.sections = sections;
    found.push(`${sections.length} ${sections.length > 1 ? "sections" : "section"}`);
  }

  const rest = lines
    .filter((l, i) => !consumed.has(i))
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  if (rest) {
    patch.constraints = clean(rest, BOUNDS.constraints);
    found.push("Contraintes");
  }
  return finish(base, patch, found);
}

// ---------------------------------------------------------------------------
// Sortie IA permissive → gabarit borné
// ---------------------------------------------------------------------------

/** Schéma PERMISSIF envoyé au modèle (forme seule) ; tout champ est facultatif. */
export const RawTemplateDraftSchema = z.object({
  durationMinutes: z.number().optional(),
  format: z.string().optional(),
  language: z.string().optional(),
  sections: z
    .array(z.object({ title: z.string().optional(), guidance: z.string().optional(), slides: z.number().optional() }))
    .optional(),
  tone: z.string().optional(),
  constraints: z.string().optional(),
});
export type RawTemplateDraft = z.infer<typeof RawTemplateDraftSchema>;

export function normalizeTemplateDraft(raw: RawTemplateDraft, base: PromptTemplate): TemplateImport {
  const found: string[] = [];
  const patch: Partial<PromptTemplate> = {};
  if (typeof raw.durationMinutes === "number" && Number.isFinite(raw.durationMinutes)) {
    patch.durationMinutes = clamp(Math.round(raw.durationMinutes), BOUNDS.minDuration, BOUNDS.maxDuration);
    found.push(`Durée : ${patch.durationMinutes} min`);
  }
  const format = raw.format && /16\s*[:/x×]\s*9/.test(raw.format) ? "16:9" : raw.format && /4\s*[:/x×]\s*3/.test(raw.format) ? "4:3" : null;
  if (format) {
    patch.format = format;
    found.push(`Format : ${format}`);
  }
  const lang = raw.language ? deaccent(raw.language.trim().toLowerCase()) : "";
  const language = /^(en|anglais|english)/.test(lang) ? "en" : /^(fr|francais|french)/.test(lang) ? "fr" : null;
  if (language) {
    patch.language = language;
    found.push(`Langue : ${languageLabel(language)}`);
  }
  if (raw.sections) {
    const sections = boundSections(raw.sections.map((s) => ({ title: s.title ?? "", guidance: s.guidance ?? "", slides: s.slides ?? 1 })));
    if (sections.length > 0) {
      patch.sections = sections;
      found.push(`${sections.length} ${sections.length > 1 ? "sections" : "section"}`);
    }
  }
  const tone = raw.tone ? clean(raw.tone, BOUNDS.tone) : "";
  if (tone) {
    patch.tone = tone;
    found.push("Ton");
  }
  const constraints = raw.constraints ? clean(raw.constraints, BOUNDS.constraints) : "";
  if (constraints) {
    patch.constraints = constraints;
    found.push("Contraintes");
  }
  return finish(base, patch, found);
}
