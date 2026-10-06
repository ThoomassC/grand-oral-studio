import { normalizeClassification } from "../classification";
import type { ClassificationResult, ProgramContext, ThemeRef } from "../contracts";
import { truncateText } from "../normalize";
import { LIMITS, stripControlChars, type Classification } from "../schemas";
import { bigramsOf, deaccent, extractTerms, normalizeText, type Term } from "./text";

/**
 * Reconnaissance gratuite du thème d'une problématique — fonction pure et
 * déterministe, sans IA.
 *
 * 1. Chaque thème devient un sac de racines et de bigrammes pondérés : nom ×3,
 *    mots-clés ×3, description ×1.
 * 2. TF-IDF sur l'ensemble des thèmes du programme (IDF lissé), similarité
 *    cosinus avec la problématique, plus un bonus quand un mot-clé entier du
 *    thème se retrouve dans la problématique.
 * 3. Confiance : softmax des scores, plafonnée selon le meilleur score absolu.
 *    Sans mot en commun, toutes les confiances restent ≤ 0,3 ; jamais 1.
 *
 * Le résultat passe par `normalizeClassification`, comme la réponse de l'IA.
 */

const WEIGHT_NAME = 3;
const WEIGHT_KEYWORD = 3;
const WEIGHT_DESCRIPTION = 1;
/** Poids d'une correspondance approchée (préfixe commun ≥ 5 lettres, ex. « rançon » / « rançongiciel »). */
const WEIGHT_PREFIX_MATCH = 0.6;
const MIN_PREFIX = 5;
/** Bonus par mot-clé du thème retrouvé en entier dans la problématique, plafonné. */
const KEYWORD_BONUS = 0.08;
const KEYWORD_BONUS_CAP = 0.24;
/** Température du softmax (les scores vont de 0 à ~1,2). */
const TEMPERATURE = 0.08;
/** Score absolu à partir duquel la confiance n'est plus plafonnée par prudence. */
const CONFIDENT_SCORE = 0.45;
/** Plafond quand aucun mot n'est en commun / quand le score est franc. */
const LOW_CAP = 0.3;
const HIGH_CAP = 0.95;
const MAX_CANDIDATES = 3;
const MAX_RATIONALE_WORDS = 5;

type Vector = Map<string, number>;

const unigramKey = (s: string) => `u:${s}`;
const bigramKey = (s: string) => `b:${s}`;

function addTo(vec: Vector, key: string, weight: number): void {
  vec.set(key, (vec.get(key) ?? 0) + weight);
}

/** Ajoute les unigrammes et bigrammes d'un fragment (les bigrammes ne franchissent pas les fragments). */
function addFragment(vec: Vector, text: string, weight: number): void {
  const stems = extractTerms(text).map((t) => t.stem);
  for (const s of stems) addTo(vec, unigramKey(s), weight);
  for (const b of bigramsOf(stems)) addTo(vec, bigramKey(b), weight);
}

function themeCounts(theme: ThemeRef): Vector {
  const vec: Vector = new Map();
  addFragment(vec, theme.name, WEIGHT_NAME);
  for (const keyword of theme.keywords) addFragment(vec, keyword, WEIGHT_KEYWORD);
  addFragment(vec, theme.description, WEIGHT_DESCRIPTION);
  return vec;
}

function norm(vec: Vector): number {
  let sum = 0;
  for (const v of vec.values()) sum += v * v;
  return Math.sqrt(sum);
}

function cosine(a: Vector, b: Vector): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  let dot = 0;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w !== undefined) dot += v * w;
  }
  return dot / (na * nb);
}

function sharesPrefix(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_PREFIX && long.startsWith(short);
}

/**
 * Vecteur de la problématique, exprimé dans le vocabulaire des thèmes : une
 * racine absente du vocabulaire est rattachée aux racines qui partagent avec
 * elle un préfixe d'au moins 5 lettres (poids réduit, réparti).
 * Renvoie aussi, pour chaque racine, la forme affichable du mot de la problématique.
 */
function problemVector(terms: Term[], vocabulary: ReadonlySet<string>, unigramVocabulary: readonly string[]) {
  const vec: Vector = new Map();
  const surfaces = new Map<string, string>();
  const note = (key: string, surface: string) => {
    if (!surfaces.has(key)) surfaces.set(key, surface);
  };

  for (const term of terms) {
    const key = unigramKey(term.stem);
    if (vocabulary.has(key)) {
      addTo(vec, key, 1);
      note(key, term.surface);
      continue;
    }
    const related = unigramVocabulary.filter((s) => sharesPrefix(s, term.stem));
    for (const s of related) {
      addTo(vec, unigramKey(s), WEIGHT_PREFIX_MATCH / related.length);
      note(unigramKey(s), term.surface);
    }
  }
  for (const b of bigramsOf(terms.map((t) => t.stem))) {
    const key = bigramKey(b);
    if (vocabulary.has(key)) addTo(vec, key, 1);
  }
  return { vec, surfaces };
}

/** Mots-clés du thème dont toutes les racines figurent dans la problématique. */
function matchedKeywords(theme: ThemeRef, problemStems: ReadonlySet<string>): string[] {
  return theme.keywords.filter((keyword) => {
    const stems = extractTerms(keyword).map((t) => t.stem);
    return stems.length > 0 && stems.every((s) => problemStems.has(s));
  });
}

function softmax(scores: readonly number[]): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / TEMPERATURE));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / total);
}

/** Première lettre en majuscule, espaces fusionnés, « ? » final si c'est une question. */
export function cleanProblem(problem: string): string {
  const compact = stripControlChars(problem).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const capitalized = compact.charAt(0).toUpperCase() + compact.slice(1);
  if (!looksLikeQuestion(capitalized)) return truncateText(capitalized, LIMITS.reformulated);
  const body = capitalized.replace(/[\s.?!…:;,]+$/, "");
  // Espace insécable avant le point d'interrogation (typographie française).
  return `${truncateText(body, LIMITS.reformulated - 2)} ?`;
}

const QUESTION_START =
  /^(comment|pourquoi|quel|quelle|quels|quelles|combien|en quoi|dans quelle mesure|faut il|peut on|doit on|est ce|qu est ce|qui|ou|a quel|how|why|what|which|who|should|can|could|is|are|does|do|to what extent)\b/;
/** Inversion sujet-verbe : « transforme-t-il », « peut-on », « est-elle »… */
const INVERSION = /[a-z\u00e0-\u00f6\u00f8-\u00ff\u0153]-(?:t-)?(?:il|elle|on|ils|elles)(?![a-z\u00e0-\u00f6\u00f8-\u00ff\u0153])/i;

function looksLikeQuestion(value: string): boolean {
  if (value.includes("?")) return true;
  if (INVERSION.test(value)) return true;
  return QUESTION_START.test(deaccent(normalizeText(value)));
}

function rationaleFor(
  matchedSurfaces: string[],
  keywords: string[],
  anyOverlap: boolean,
): string {
  if (!anyOverlap) return "Aucun mot-clé en commun : proposition par défaut, vérifiez le sujet.";
  if (matchedSurfaces.length === 0) return "Aucun mot en commun avec ce sujet.";
  const parts = [`Mots en commun : ${matchedSurfaces.join(", ")}.`];
  if (keywords.length > 0) parts.push(`Mot${keywords.length > 1 ? "s" : ""}-clé${keywords.length > 1 ? "s" : ""} du sujet retrouvé${keywords.length > 1 ? "s" : ""} : ${keywords.join(", ")}.`);
  return truncateText(parts.join(" "), LIMITS.rationale);
}

interface Scored {
  theme: ThemeRef;
  score: number;
  surfaces: string[];
  keywords: string[];
}

export function classifyProblemFree(
  ctx: ProgramContext,
  problem: string,
  hintedThemeId?: string | null,
): ClassificationResult {
  const reformulatedProblem = cleanProblem(problem);
  const themes = ctx.themes;
  if (themes.length === 0) return { reformulatedProblem, ranked: [] };

  // Documents et IDF lissé : idf = ln((1 + N) / (1 + df)) + 1.
  const counts = themes.map(themeCounts);
  const df = new Map<string, number>();
  for (const vec of counts) for (const key of vec.keys()) df.set(key, (df.get(key) ?? 0) + 1);
  const idf = (key: string) => Math.log((1 + themes.length) / (1 + (df.get(key) ?? 0))) + 1;
  const weigh = (vec: Vector): Vector => new Map([...vec].map(([k, v]) => [k, v * idf(k)]));

  // Vocabulaire trié : le rattachement par préfixe ne dépend pas de l'ordre des thèmes.
  const vocabulary = new Set(df.keys());
  const unigramVocabulary = [...vocabulary]
    .filter((k) => k.startsWith("u:"))
    .map((k) => k.slice(2))
    .sort();

  const terms = extractTerms(problem);
  const problemStems = new Set(terms.map((t) => t.stem));
  const { vec: rawProblem, surfaces } = problemVector(terms, vocabulary, unigramVocabulary);
  const problemVec = weigh(rawProblem);

  const scored: Scored[] = themes.map((theme, i) => {
    const themeVec = weigh(counts[i]);
    const keywords = matchedKeywords(theme, problemStems);
    const bonus = Math.min(KEYWORD_BONUS_CAP, KEYWORD_BONUS * keywords.length);
    // Contribution de chaque clé partagée, pour citer les mots les plus parlants.
    // Seuls les unigrammes sont cités : un bigramme répéterait ses deux mots.
    const shared = [...problemVec]
      .filter(([k]) => k.startsWith("u:") && themeVec.has(k))
      .map(([k, v]) => ({ key: k, weight: v * (themeVec.get(k) ?? 0) }))
      .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
    const seen = new Set<string>();
    const words: string[] = [];
    for (const { key } of shared) {
      const surface = surfaces.get(key);
      if (!surface || seen.has(surface)) continue;
      seen.add(surface);
      words.push(surface);
      if (words.length === MAX_RATIONALE_WORDS) break;
    }
    return { theme, score: cosine(problemVec, themeVec) + bonus, surfaces: words, keywords };
  });

  // Ordre total et déterministe : score décroissant, puis identifiant.
  scored.sort((a, b) => b.score - a.score || a.theme.id.localeCompare(b.theme.id));

  const best = scored[0].score;
  const anyOverlap = best > 0;
  const cap = anyOverlap ? LOW_CAP + (HIGH_CAP - LOW_CAP) * Math.min(1, best / CONFIDENT_SCORE) : LOW_CAP;
  const probabilities = softmax(scored.map((s) => s.score));

  const toCandidate = (s: Scored, i: number): Classification["candidates"][number] => ({
    themeId: s.theme.id,
    confidence: Math.min(HIGH_CAP, cap * probabilities[i]),
    rationale: rationaleFor(s.surfaces, s.keywords, anyOverlap),
  });

  const candidates = scored.slice(0, MAX_CANDIDATES).map(toCandidate);
  // Le thème annoncé garde sa vraie confiance et sa justification même hors du top 3.
  const hintedIndex = hintedThemeId ? scored.findIndex((s) => s.theme.id === hintedThemeId) : -1;
  if (hintedIndex >= MAX_CANDIDATES) candidates.push(toCandidate(scored[hintedIndex], hintedIndex));

  return normalizeClassification({ reformulatedProblem, candidates }, themes, hintedThemeId);
}
