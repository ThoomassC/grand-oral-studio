/**
 * Normalisation du français pour le mode gratuit — fonctions pures.
 *
 * Chaîne : minuscules → élisions retirées (l', d', qu'…) → ponctuation en
 * espaces → mots vides écartés → accents retirés → racinisation légère.
 * La racinisation est volontairement prudente : elle rapproche les formes
 * d'une même famille (pluriel, féminin, -tion, -ité, -iser…) sans chercher à
 * être exhaustive. Une racine fausse coûte plus cher qu'une racine manquée.
 */

/** Retire les diacritiques (NFD) et développe les ligatures œ/æ. */
export function deaccent(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/Œ/g, "OE")
    .replace(/Æ/g, "AE");
}

/** Tout ce qui n'est ni lettre latine (accentuée comprise, deux casses) ni chiffre. */
const NON_WORD = /[^a-z0-9À-ÖØ-öø-ÿŒœ]+/gi;
const APOSTROPHES = /['’ʼ`´]/g;
/** Élisions : l', d', j', m', n', s', t', c', qu', jusqu', lorsqu', puisqu', quoiqu'. */
const ELISION = /(^|[^a-zÀ-ÖØ-öø-ÿŒœ])(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)'/gi;

/** Mots d'un texte, casse d'origine conservée, élisions retirées, ponctuation (traits d'union compris) écartée. */
function splitWords(value: string): string[] {
  return value
    .replace(APOSTROPHES, "'")
    .replace(ELISION, "$1")
    .replace(NON_WORD, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
}

/**
 * Minuscules, élisions retirées, ponctuation (traits d'union compris) remplacée
 * par des espaces, espaces fusionnés. Les accents sont CONSERVÉS : c'est la
 * forme d'affichage des mots. `deaccent` sert à la comparaison.
 */
export function normalizeText(value: string): string {
  return splitWords(value.toLowerCase()).join(" ");
}

/** Sigle : au moins deux caractères, aucune minuscule et au moins une lettre (« IA », « RGPD », « PME »). */
function isAcronym(word: string): boolean {
  return word.length >= 2 && word === word.toUpperCase() && word !== word.toLowerCase();
}

/** Mots vides, sans accents (comparés après `deaccent`). Français, et un socle anglais. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  // Articles, prépositions, conjonctions
  "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "et", "ou", "ni", "mais", "donc", "or", "car",
  "en", "dans", "pour", "par", "sur", "sous", "avec", "sans", "entre", "vers", "chez", "contre", "selon",
  "depuis", "pendant", "avant", "apres", "grace", "face", "parmi", "comme", "afin", "lors",
  // Pronoms, déterminants
  "ce", "cet", "cette", "ces", "ceci", "cela", "ca", "celui", "celle", "ceux", "celles",
  "il", "ils", "elle", "elles", "on", "je", "tu", "nous", "vous", "me", "te", "se", "moi", "toi", "lui", "leur", "leurs",
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "y",
  "qui", "que", "quoi", "dont", "lequel", "laquelle", "lesquels", "lesquelles",
  "quel", "quelle", "quels", "quelles", "tout", "tous", "toute", "toutes", "chaque", "autre", "autres",
  "meme", "memes", "certain", "certains", "certaine", "certaines", "plusieurs", "aucun", "aucune",
  // Interrogation et tournures de problématique
  "comment", "pourquoi", "combien", "quand", "est", "peut", "peuvent", "doit", "doivent", "faut",
  "mesure", "point", "si", "ne", "pas", "plus", "moins", "tres", "trop", "aussi", "encore", "deja",
  "bien", "mieux", "peu", "ainsi", "alors", "toujours", "jamais", "aujourd", "hui", "desormais",
  // Auxiliaires et verbes très courants
  "etre", "sont", "etait", "sera", "seront", "ete", "avoir", "ont", "avait", "aura", "ai",
  "fait", "faire", "font", "rend", "rendre", "permet", "permettre", "permettent",
  // Anglais
  "the", "a", "an", "of", "and", "or", "in", "to", "for", "with", "by", "from", "at", "as", "is", "are", "be",
  "how", "why", "what", "which", "who", "can", "should", "could", "would", "does", "do", "its", "their", "this",
  "that", "these", "those", "it", "into", "than", "extent", "will",
]);

/** Suffixes [à retirer, remplacement], du plus long au plus court. Un seul est appliqué. */
const SUFFIXES: ReadonlyArray<readonly [string, string]> = [
  ["abilite", "abl"],
  ["isation", ""],
  ["euriat", ""],
  ["ation", ""],
  ["ement", ""],
  ["tion", ""],
  ["ment", ""],
  ["iser", ""],
  ["ique", ""],
  ["euse", ""],
  ["elle", ""],
  ["ite", ""],
  ["eur", ""],
  ["ive", "if"],
  ["ale", ""],
  ["al", ""],
  ["el", ""],
  ["ie", ""],
  ["er", ""],
  ["e", ""],
];

/** Longueur minimale de la racine restante : en dessous, le suffixe n'est pas retiré. */
const MIN_STEM = 4;

/**
 * Racinisation légère d'un mot SANS accents et en minuscules.
 * 1. Pluriel : -aux → -al, sinon -s / -x final (hors -ss).
 * 2. Un suffixe dérivationnel (liste ci-dessus), si la racine garde ≥ 4 lettres
 *    (≥ 3 pour une règle de remplacement).
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("aux")) w = `${w.slice(0, -3)}al`;
  else if (w.length > 3 && /[sx]$/.test(w) && !w.endsWith("ss")) w = w.slice(0, -1);

  for (const [suffix, replacement] of SUFFIXES) {
    // Une règle de remplacement (-abilité → -abl) garde une racine lisible dès 3 lettres.
    const minBase = replacement ? MIN_STEM - 1 : MIN_STEM;
    if (w.endsWith(suffix) && w.length - suffix.length >= minBase) {
      return w.slice(0, -suffix.length) + replacement;
    }
  }
  return w;
}

/** Un mot porteur de sens : sa forme d'affichage et sa racine de comparaison. */
export interface Term {
  /** Forme rencontrée, accents conservés, en minuscules sauf les sigles (ex. « numériques », « RGPD »). */
  surface: string;
  /** Racine sans accents (ex. « numer »). */
  stem: string;
}

function isContentWord(bare: string): boolean {
  if (STOP_WORDS.has(bare)) return false;
  if (/^\d+$/.test(bare)) return bare.length >= 4; // années (2030) gardées, petits nombres écartés
  return bare.length >= 2;
}

/** Mots porteurs de sens d'un texte, dans l'ordre, mots vides écartés. */
export function extractTerms(value: string): Term[] {
  const terms: Term[] = [];
  for (const word of splitWords(value)) {
    const surface = isAcronym(word) ? word : word.toLowerCase();
    const bare = deaccent(word.toLowerCase());
    if (!isContentWord(bare)) continue;
    terms.push({ surface, stem: stem(bare) });
  }
  return terms;
}

/** Racines (unigrammes) et bigrammes de racines consécutives (après retrait des mots vides). */
export interface Analysis {
  unigrams: string[];
  bigrams: string[];
}

export function bigramsOf(stems: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < stems.length; i++) out.push(`${stems[i - 1]} ${stems[i]}`);
  return out;
}

export function analyze(value: string): Analysis {
  const unigrams = extractTerms(value).map((t) => t.stem);
  return { unigrams, bigrams: bigramsOf(unigrams) };
}
