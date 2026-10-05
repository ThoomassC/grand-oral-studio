import { z } from "zod";
import { SAFE_FONTS } from "../fonts";
import { stripControlChars, ThemeInputSchema, type Brand, type ThemeInput } from "../schemas";
import { dedupeKeywords, splitKeywords, themeNameKey } from "../theme-name";
import { brandFromTheme } from "./brand-from-theme";

/**
 * Thèmes ET charte graphique préremplis à partir d'un texte libre décrivant un
 * oral (prompt collé dans l'onglet Thèmes).
 *
 * `parseThemePromptText` : heuristiques FR/EN, sans IA (moteur gratuit).
 * `normalizeThemePromptDraft` : ramène une sortie IA permissive dans les bornes.
 *
 * Garanties communes (fonctions pures) :
 *   - thèmes nettoyés, dédoublonnés (casse et accents ignorés), conformes à
 *     ThemeInputSchema, 60 au plus ;
 *   - `brand` null si rien de graphique n'a été reconnu ; sinon une charte
 *     valide (BrandSchema) complétée depuis la charte actuelle, polices
 *     ramenées à SAFE_FONTS et contraste texte/fond ≥ 4,5:1, corrections
 *     signalées dans `brandNotes` (via `brandFromTheme`) ;
 *   - `found` décrit ce qui a été repris, sans jamais recopier le texte entier.
 */

export const MAX_PROMPT_THEMES = 60;

const BOUNDS = { name: 120, description: 2000, keyword: 60, keywords: 30, noteValue: 40, fontName: 80 } as const;

export interface ThemePromptImport {
  themes: ThemeInput[];
  brand: Brand | null;
  brandNotes: string[];
  found: string[];
}

type ColorRole = "primary" | "secondary" | "accent" | "background" | "text";
type FontRole = "heading" | "body";

const COLOR_ROLES: readonly ColorRole[] = ["primary", "secondary", "accent", "background", "text"];
const COLOR_LABEL: Record<ColorRole, string> = {
  primary: "principale",
  secondary: "secondaire",
  accent: "d'accent",
  background: "de fond",
  text: "du texte",
};
const FONT_LABEL: Record<FontRole, string> = { heading: "des titres", body: "du texte" };

// ---------------------------------------------------------------------------
// Texte : normalisation à longueur constante (les positions restent valables)
// ---------------------------------------------------------------------------

/** Minuscules sans accents, caractère par caractère : `fold(s).length === s.length`. */
function fold(value: string): string {
  let out = "";
  for (const ch of value) {
    const base = String.fromCodePoint(ch.normalize("NFD").codePointAt(0) ?? 0);
    const lower = base.toLowerCase();
    const kept = lower.length === ch.length ? lower : base.length === ch.length ? base : ch;
    out += kept;
  }
  return out;
}

function clean(value: string, max: number): string {
  const s = stripControlChars(value).replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Expression « mot entier » sur un texte replié ; les espaces internes tolèrent aussi un trait d'union. */
function wordPattern(folded: string): RegExp {
  const body = folded.split(/[\s-]+/).map(escapeRegExp).join("[\\s-]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "gu");
}

// ---------------------------------------------------------------------------
// Couleurs : codes hex et table de noms FR/EN courants
// ---------------------------------------------------------------------------

/** Noms repliés (minuscules, sans accents) → #RRGGBB. « or » est exclu (conjonction). */
const COLOR_NAMES: ReadonlyArray<readonly [readonly string[], string]> = [
  [["noir", "noire", "noirs", "noires", "black"], "#000000"],
  [["blanc", "blanche", "blancs", "blanches", "white"], "#FFFFFF"],
  [["blanc casse", "off white"], "#F5F5F0"],
  [["gris", "grise", "grises", "grey", "gray"], "#808080"],
  [["gris clair", "light grey", "light gray"], "#D3D3D3"],
  [["gris fonce", "gris foncee", "dark grey", "dark gray"], "#404040"],
  [["anthracite", "charcoal"], "#2F3640"],
  [["argent", "argente", "argentee", "silver"], "#C0C0C0"],
  [["rouge", "rouges", "red"], "#C62828"],
  [["bordeaux", "burgundy"], "#800020"],
  [["rose", "roses", "pink"], "#E91E63"],
  [["corail", "coral"], "#FF7F50"],
  [["saumon", "salmon"], "#FA8072"],
  [["orange", "orangee"], "#F57C00"],
  [["jaune", "jaunes", "yellow"], "#FBC02D"],
  [["dore", "doree", "gold", "golden"], "#D4AF37"],
  [["beige"], "#F5F5DC"],
  [["creme", "cream"], "#FFFDD0"],
  [["ivoire", "ivory"], "#FFFFF0"],
  [["sable", "sand"], "#C2B280"],
  [["marron", "brun", "brune", "brown"], "#6D4C41"],
  [["chocolat", "chocolate"], "#5D4037"],
  [["vert", "verte", "verts", "vertes", "green"], "#2E7D32"],
  [["vert fonce", "vert foncee", "vert sapin", "dark green"], "#1B5E20"],
  [["vert clair", "light green"], "#81C784"],
  [["vert olive", "olive"], "#808000"],
  [["kaki", "khaki"], "#8A864E"],
  [["emeraude", "emerald"], "#2ECC71"],
  [["turquoise"], "#1ABC9C"],
  [["bleu canard", "teal"], "#008080"],
  [["cyan"], "#00BCD4"],
  [["bleu", "bleue", "bleus", "bleues", "blue"], "#1565C0"],
  [["bleu marine", "marine", "navy", "navy blue", "bleu nuit", "midnight blue"], "#1F3A5F"],
  [["bleu fonce", "bleu foncee", "dark blue"], "#0D47A1"],
  [["bleu clair", "light blue"], "#64B5F6"],
  [["bleu ciel", "sky blue", "azur"], "#87CEEB"],
  [["bleu roi", "royal blue"], "#4169E1"],
  [["violet", "violette", "violets", "purple"], "#6A1B9A"],
  [["mauve"], "#B784A7"],
  [["lavande", "lavender"], "#B57EDC"],
  [["prune", "plum"], "#8E4585"],
  [["indigo"], "#4B0082"],
  [["magenta", "fuchsia"], "#D81B60"],
];

/** Plus long d'abord : « bleu marine » l'emporte sur « bleu » et « marine ». */
const COLOR_PATTERNS: ReadonlyArray<{ pattern: RegExp; hex: string }> = COLOR_NAMES.flatMap(([names, hex]) =>
  names.map((name) => ({ name: fold(name), hex })),
)
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name, hex }) => ({ pattern: wordPattern(name), hex }));

const HASH_HEX = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/giu;

function expandHex(digits: string): string {
  const d = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  return `#${d.toUpperCase()}`;
}

interface Span<T> {
  start: number;
  end: number;
  value: T;
}

function overlaps(spans: readonly Span<unknown>[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

/** Couleurs d'un texte REPLIÉ : codes « #… » puis noms, sans chevauchement, dans l'ordre du texte. */
function findColors(folded: string): Span<string>[] {
  const spans: Span<string>[] = [];
  for (const m of folded.matchAll(HASH_HEX)) {
    spans.push({ start: m.index, end: m.index + m[0].length, value: expandHex(m[1] ?? "") });
  }
  // Noms absorbés par le code qui les suit : ni eux ni un nom plus court ne comptent.
  const absorbed: Span<null>[] = [];
  for (const { pattern, hex } of COLOR_PATTERNS) {
    for (const m of folded.matchAll(pattern)) {
      const end = m.index + m[0].length;
      if (overlaps(spans, m.index, end) || overlaps(absorbed, m.index, end)) continue;
      // « bleu marine #1F3A5F », « rouge (#B71C1C) » : le nom annonce le code qui suit,
      // c'est une seule couleur et le code fait foi.
      if (spans.some((s) => s.start >= end && /^[\s(:–—-]{0,3}$/u.test(folded.slice(end, s.start)) && folded[s.start] === "#")) {
        absorbed.push({ start: m.index, end, value: null });
        continue;
      }
      spans.push({ start: m.index, end, value: hex });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Une valeur de couleur (sortie d'IA ou fragment de texte) → #RRGGBB : code hex
 * (avec ou sans dièse, 3 ou 6 chiffres), sinon premier nom de couleur reconnu.
 */
export function colorFromText(value: string): string | null {
  const folded = fold(value.trim());
  if (!folded) return null;
  const bare = /^([0-9a-f]{6}|[0-9a-f]{3})$/.exec(folded);
  if (bare?.[1]) return expandHex(bare[1]);
  const hash = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/u.exec(folded);
  if (hash?.[1]) return expandHex(hash[1]);
  return findColors(folded)[0]?.value ?? null;
}

// ---------------------------------------------------------------------------
// Polices : noms de SAFE_FONTS cités
// ---------------------------------------------------------------------------

const FONT_PATTERNS = [...SAFE_FONTS]
  .sort((a, b) => b.length - a.length)
  .map((font) => ({ font, pattern: wordPattern(fold(font)) }));

function findFonts(folded: string): Span<string>[] {
  const spans: Span<string>[] = [];
  for (const { font, pattern } of FONT_PATTERNS) {
    for (const m of folded.matchAll(pattern)) {
      const end = m.index + m[0].length;
      if (!overlaps(spans, m.index, end)) spans.push({ start: m.index, end, value: font });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Rôles : mots repères et affectation par proximité
// ---------------------------------------------------------------------------

type Keywords<R extends string> = ReadonlyArray<{ role: R | "generic"; pattern: RegExp }>;

function keywords<R extends string>(table: ReadonlyArray<readonly [R | "generic", readonly string[]]>): Keywords<R> {
  return table.flatMap(([role, words]) => words.map((w) => ({ role, pattern: wordPattern(fold(w)) })));
}

const COLOR_KEYWORDS = keywords<ColorRole>([
  ["primary", ["principale", "principal", "primaire", "dominante", "primary"]],
  ["secondary", ["secondaire", "secondary"]],
  ["accent", ["accent", "accents", "highlight"]],
  ["background", ["fond", "fonds", "arriere-plan", "background"]],
  ["text", ["texte", "textes", "text", "ecriture"]],
  ["generic", ["couleur", "couleurs", "color", "colors", "colour", "colours", "palette", "teinte", "teintes"]],
]);

const FONT_KEYWORDS = keywords<FontRole>([
  ["heading", ["titre", "titres", "title", "titles", "heading", "headings", "intertitre", "intertitres"]],
  ["body", ["texte", "textes", "text", "corps", "body", "paragraphe", "paragraphes", "contenu"]],
  ["generic", ["police", "polices", "font", "fonts", "typo", "typographie", "typeface"]],
]);

interface Assignment<R extends string> {
  specific: Array<[R, string]>;
  generic: string[];
}

/**
 * Dans un segment (phrase, ligne) : chaque valeur va au premier mot repère
 * spécifique encore libre qui la précède (« fond blanc et texte noir »), sinon
 * au premier qui la suit (« #123456 en couleur principale »). Sans repère
 * spécifique, une valeur n'est retenue que si un repère générique
 * (« couleurs », « police ») figure dans le segment.
 */
function assign<R extends string>(folded: string, table: Keywords<R>, values: Span<string>[]): Assignment<R> {
  const marks: Array<{ start: number; end: number; role: R }> = [];
  let hasGeneric = false;
  for (const { role, pattern } of table) {
    for (const m of folded.matchAll(pattern)) {
      const end = m.index + m[0].length;
      if (overlaps(values, m.index, end)) continue; // « text » dans un nom, etc.
      if (role === "generic") hasGeneric = true;
      else marks.push({ start: m.index, end, role: role as R });
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const used = new Set<number>();
  const out: Assignment<R> = { specific: [], generic: [] };
  for (const v of values) {
    let k = marks.findIndex((m, i) => !used.has(i) && m.end <= v.start);
    if (k < 0) k = marks.findIndex((m, i) => !used.has(i) && m.start >= v.end);
    const mark = k >= 0 ? marks[k] : undefined;
    if (mark) {
      used.add(k);
      out.specific.push([mark.role, v.value]);
    } else if (hasGeneric) {
      out.generic.push(v.value);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Charte : complétée depuis la charte actuelle, garanties de brandFromTheme
// ---------------------------------------------------------------------------

interface BrandPatch {
  colors: Partial<Record<ColorRole, string>>;
  /** Noms de police tels que reçus (ramenés à SAFE_FONTS par brandFromTheme). */
  fonts: Partial<Record<FontRole, string>>;
}

function buildBrand(patch: BrandPatch, current: Brand): { brand: Brand | null; notes: string[]; found: string[] } {
  const colorRoles = COLOR_ROLES.filter((r) => patch.colors[r] !== undefined);
  const fontRoles = (["heading", "body"] as const).filter((r) => patch.fonts[r] !== undefined);
  if (colorRoles.length === 0 && fontRoles.length === 0) return { brand: null, notes: [], found: [] };

  const c = { ...current.colors, ...patch.colors };
  const { brand, notes } = brandFromTheme({
    name: current.name,
    colors: { accent1: c.primary, accent2: c.secondary, accent3: c.accent, lt1: c.background, dk1: c.text },
    fonts: { major: patch.fonts.heading ?? current.fonts.heading, minor: patch.fonts.body ?? current.fonts.body },
    logoDataUrl: current.logoDataUrl,
    notes: [],
  });
  const found = [
    ...colorRoles.map((r) => `Couleur ${COLOR_LABEL[r]} : ${patch.colors[r]}`),
    ...fontRoles.map((r) => `Police ${FONT_LABEL[r]} : ${brand.fonts[r]}`),
  ];
  return { brand, notes, found };
}

// ---------------------------------------------------------------------------
// Thèmes : bornes et dédoublonnage
// ---------------------------------------------------------------------------

interface DraftTheme {
  name: string;
  description: string;
  keywords: readonly string[];
}

function boundThemes(drafts: readonly DraftTheme[]): ThemeInput[] {
  const out: ThemeInput[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    if (out.length >= MAX_PROMPT_THEMES) break;
    const name = clean(d.name.replace(/[*`]/g, ""), BOUNDS.name);
    if (name.length < 2) continue;
    const key = themeNameKey(name);
    if (seen.has(key)) continue;
    const parsed = ThemeInputSchema.safeParse({
      name,
      description: clean(d.description, BOUNDS.description),
      keywords: dedupeKeywords(d.keywords.map((k) => clean(k, BOUNDS.keyword))).slice(0, BOUNDS.keywords),
      // Pas de notes depuis un prompt libre : aucune frontière fiable dans le texte.
      notes: "",
    });
    if (!parsed.success) continue; // défense en profondeur : les bornes ci-dessus suffisent
    seen.add(key);
    out.push(parsed.data);
  }
  return out;
}

function themesFound(themes: readonly ThemeInput[]): string[] {
  if (themes.length === 0) return [];
  return [`${themes.length} ${themes.length > 1 ? "thèmes" : "thème"}`];
}

// ---------------------------------------------------------------------------
// Heuristiques (moteur gratuit)
// ---------------------------------------------------------------------------

const NUMBERED = /^\s*(\d{1,2})\s*[.)\-–:]\s+(.+)$/;
const NUMBERED_THEME = /^\s*(?:th[eè]me|theme|sujet|topic)\s*(?:n[°o]\s*)?(\d{1,2})\s*[:.)\-–]\s*(.+)$/i;
const BULLET = /^\s*[-*•–]\s+(.+)$/;
const THEME_HEADER = /^\s*(?:[\p{L}'’]+\s+){0,2}?(?:th[eè]mes?|themes?|sujets?|topics?)\b[^:：]{0,40}[:：]\s*(.*)$/iu;
const KEY_VALUE_LINE = /^\s*[\p{L}'’ ]{2,40}[:：]/u;
const METADATA_START = /^(?:duree|duration|format|langue|language|ton|tone)\s*[:：]/;
const BRAND_START =
  /^(?:couleurs?|colou?rs?|palette|polices?|fonts?|typo\w*|charte|fond|textes?|background|principale?|secondaire|accent|titres?|corps)(?![\p{L}\p{N}])/u;

/** Après une fin de phrase : un en-tête de thèmes (« Thèmes : ») ou une consigne de charte (« Couleur principale… », « Fond blanc »). */
const INLINE_KEYWORD =
  /(?<=[.;!?])\s+(?=(?:th[eè]mes?|themes?|sujets?|topics?)\s*[:：]|(?:couleurs?|colou?rs?|palette|polices?|fonts?|typo\p{L}*|charte|fond|textes?|background|titres?)(?![\p{L}\p{N}]))/giu;
const INLINE_MARKER = /(^|\s)(\d{1,2})[.)]\s+(?=\p{L})/gu;

/**
 * Prompt collé sur une seule ligne (« Thèmes : 1. X 2. Y. Couleurs : … ») : une
 * consigne par ligne. Un numéro n'ouvre une ligne que s'il prolonge la suite
 * 1, 2, 3… (même règle que l'analyse des consignes de gabarit).
 */
function splitInline(text: string): string {
  let expected = 1;
  return text.replace(INLINE_KEYWORD, "\n").replace(INLINE_MARKER, (match: string, lead: string, num: string) => {
    if (Number(num) !== expected) return match;
    expected += 1;
    return `${lead ? "\n" : ""}${num}. `;
  });
}

/** Ligne de charte (« Couleur principale : bleu ») plutôt qu'un thème. */
function isBrandOrMetadata(content: string): boolean {
  const folded = fold(content.trim().replace(/^[*_`]+/, ""));
  if (METADATA_START.test(folded)) return true;
  if (!BRAND_START.test(folded)) return false;
  return findColors(folded).length > 0 || findFonts(folded).length > 0;
}

function trimEnd(value: string): string {
  return value.replace(/[\s:;,.—–-]+$/, "").trim();
}

/** Contenu d'un élément de liste → thème brut (« Nom | desc | mots » ou « Nom : description »). */
function parseItem(content: string): DraftTheme {
  if (content.includes("|")) {
    const [name = "", description = "", ...rest] = content.split("|").map((p) => p.trim());
    return { name: trimEnd(name), description, keywords: splitKeywords(rest.join(",")) };
  }
  const rest = trimEnd(content);
  const split = /\s*(?:[:：]|\s[—–-])\s+/.exec(rest);
  const name = split ? rest.slice(0, split.index) : rest;
  const description = split ? rest.slice(split.index + split[0].length) : "";
  return { name: trimEnd(name), description: description.trim(), keywords: [] };
}

function listContent(line: string): { kind: "numbered" | "bullet"; content: string } | null {
  const numberedTheme = NUMBERED_THEME.exec(line);
  if (numberedTheme?.[2]) return { kind: "numbered", content: numberedTheme[2] };
  const numbered = NUMBERED.exec(line);
  if (numbered?.[2]) return { kind: "numbered", content: numbered[2] };
  const bullet = BULLET.exec(line);
  if (bullet?.[1]) return { kind: "bullet", content: bullet[1] };
  return null;
}

/** Sans liste : « Thèmes : a, b, c » ou « Thèmes : » suivi de lignes simples (jusqu'à une ligne vide ou de charte). */
function themesUnderHeader(lines: readonly string[], consumed: Set<number>): DraftTheme[] {
  const i = lines.findIndex((line) => THEME_HEADER.test(line));
  if (i < 0) return [];
  consumed.add(i);
  const inline = THEME_HEADER.exec(lines[i] ?? "")?.[1]?.trim() ?? "";
  if (inline) return inline.split(/[,;]/).map(parseItem);
  const out: DraftTheme[] = [];
  for (let j = i + 1; j < lines.length; j += 1) {
    const next = lines[j]?.trim() ?? "";
    if (!next || (KEY_VALUE_LINE.test(next) && isBrandOrMetadata(next))) break;
    consumed.add(j);
    out.push(parseItem(next));
  }
  return out;
}

/** Thèmes du texte ; `consumed` reçoit les lignes reprises (exclues ensuite de la lecture de la charte). */
function extractThemes(lines: readonly string[], consumed: Set<number>): DraftTheme[] {
  const items = lines.flatMap((line, i) => {
    const item = listContent(line);
    return item && !isBrandOrMetadata(item.content) ? [{ i, ...item }] : [];
  });
  const kind = items.some((it) => it.kind === "numbered") ? "numbered" : "bullet";
  const picked = new Map<number, string>();
  for (const it of items) if (it.kind === kind) picked.set(it.i, it.content);
  // Format pipe hors liste : une ligne = un thème.
  lines.forEach((line, i) => {
    if (!picked.has(i) && !listContent(line) && line.includes("|") && !isBrandOrMetadata(line)) picked.set(i, line.trim());
  });

  if (picked.size === 0) return themesUnderHeader(lines, consumed);
  for (const i of picked.keys()) consumed.add(i);
  return [...picked.entries()].sort((a, b) => a[0] - b[0]).map(([, content]) => parseItem(content));
}

/** Segments où chercher couleurs et polices : lignes non reprises, coupées aux fins de phrase. */
function brandSegments(lines: readonly string[], consumed: ReadonlySet<number>): string[] {
  return lines
    .filter((_, i) => !consumed.has(i))
    .flatMap((line) => line.split(/;|\.(?=\s|$)/))
    .map(fold)
    .filter((s) => s.trim().length > 0);
}

function brandFromSegments(segments: readonly string[]): BrandPatch {
  const colors: Partial<Record<ColorRole, string>> = {};
  const fonts: Partial<Record<FontRole, string>> = {};
  const genericColors: string[] = [];
  const genericFonts: string[] = [];
  for (const seg of segments) {
    const c = assign(seg, COLOR_KEYWORDS, findColors(seg));
    for (const [role, hex] of c.specific) colors[role] ??= hex;
    genericColors.push(...c.generic);
    const f = assign(seg, FONT_KEYWORDS, findFonts(seg));
    for (const [role, font] of f.specific) fonts[role] ??= font;
    genericFonts.push(...f.generic);
  }
  // Couleurs sans rôle (« Couleurs : bordeaux et doré ») : principale, secondaire, accent.
  const freeColorRoles = (["primary", "secondary", "accent"] as const).filter((r) => colors[r] === undefined);
  genericColors.slice(0, freeColorRoles.length).forEach((hex, k) => {
    const role = freeColorRoles[k];
    if (role) colors[role] = hex;
  });
  // Police sans rôle : une seule vaut pour les titres et le texte.
  if (fonts.heading === undefined && fonts.body === undefined && genericFonts.length === 1) {
    fonts.heading = genericFonts[0];
    fonts.body = genericFonts[0];
  } else {
    for (const font of genericFonts) {
      if (fonts.heading === undefined) fonts.heading = font;
      else if (fonts.body === undefined) fonts.body = font;
    }
  }
  return { colors, fonts };
}

export function parseThemePromptText(text: string, currentBrand: Brand): ThemePromptImport {
  const lines = splitInline(stripControlChars(text)).split(/\r?\n/);
  const consumed = new Set<number>();
  const themes = boundThemes(extractThemes(lines, consumed));
  const { brand, notes, found } = buildBrand(brandFromSegments(brandSegments(lines, consumed)), currentBrand);
  return { themes, brand, brandNotes: notes, found: [...themesFound(themes), ...found] };
}

// ---------------------------------------------------------------------------
// Sortie IA permissive → thèmes et charte bornés
// ---------------------------------------------------------------------------

/** Schéma PERMISSIF envoyé au modèle (forme seule) ; tout champ est facultatif. */
export const RawThemePromptDraftSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  brand: z
    .object({
      colors: z
        .object({
          primary: z.string().optional(),
          secondary: z.string().optional(),
          accent: z.string().optional(),
          background: z.string().optional(),
          text: z.string().optional(),
        })
        .optional(),
      fonts: z.object({ heading: z.string().optional(), body: z.string().optional() }).optional(),
    })
    .optional(),
});
export type RawThemePromptDraft = z.infer<typeof RawThemePromptDraftSchema>;

export function normalizeThemePromptDraft(raw: RawThemePromptDraft, currentBrand: Brand): ThemePromptImport {
  const themes = boundThemes(
    (raw.themes ?? []).map((t) => ({ name: t.name ?? "", description: t.description ?? "", keywords: t.keywords ?? [] })),
  );
  const patch: BrandPatch = { colors: {}, fonts: {} };
  const unrecognized: string[] = [];
  for (const role of COLOR_ROLES) {
    const value = clean(raw.brand?.colors?.[role] ?? "", 200);
    if (!value) continue;
    const hex = colorFromText(value);
    if (hex) patch.colors[role] = hex;
    else {
      const shown = clean(value, BOUNDS.noteValue);
      unrecognized.push(`Couleur ${COLOR_LABEL[role]} « ${shown} » non reconnue : couleur actuelle conservée.`);
    }
  }
  for (const role of ["heading", "body"] as const) {
    const value = clean(raw.brand?.fonts?.[role] ?? "", BOUNDS.fontName);
    if (value) patch.fonts[role] = value;
  }
  const { brand, notes, found } = buildBrand(patch, currentBrand);
  return { themes, brand, brandNotes: [...unrecognized, ...notes], found: [...themesFound(themes), ...found] };
}
