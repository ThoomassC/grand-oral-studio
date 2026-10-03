import { attr, decodeEntities, elements, firstInner, hexOf, NS, withoutElements } from "./ooxml";

/**
 * Usage RÉEL des couleurs et des polices dans une présentation (fonction pure,
 * sur des XML déjà lus et bornés par l'appelant).
 *
 * Pourquoi : beaucoup de .pptx produits par un générateur (pptxgenjs,
 * python-pptx, export Canva…) gardent le thème Office par défaut et posent la
 * vraie charte en dur dans les diapositives. Lire seulement a:clrScheme
 * proposerait alors 4472C4 / ED7D31 / Calibri à la place de la charte réelle.
 *
 * Ce qui est compté (pondéré par fréquence) :
 *  - fond : fond effectif de chaque diapo (p:bg de la diapo, sinon de son
 *    layout, sinon du masque) et formes couvrant ≥ 60 % de la diapo ;
 *  - texte : couleur des runs (a:r/a:rPr/a:solidFill), pondérée par le nombre
 *    de caractères ; titres (placeholder title/ctrTitle ou taille ≥ 24 pt)
 *    séparés du corps ;
 *  - accents : couleurs chromatiques (hors gris, noir, blanc) des aplats de
 *    formes, cellules de tableau et runs ;
 *  - polices : a:latin des runs, titres et corps séparés.
 * Ce qui est ignoré : ombres et effets (a:effectLst), contours (a:ln), styles
 * par défaut des formes (p:style, qui ne pointent que sur le thème), dégradés,
 * images, et dans le masque/les layouts les placeholders (textes d'invite).
 * Les schemeClr sont résolus via le clrMap du masque et le thème ; seuls les
 * modificateurs lumMod/lumOff sont appliqués (tint, shade, alpha… ignorés).
 */

export type ThemeColors = Partial<Record<string, string>>;
export interface ThemeFonts {
  major: string | null;
  minor: string | null;
}

export interface ThemeUsage {
  /** Fond dominant (#RRGGBB), ou null si aucun n'est lisible. */
  background: string | null;
  /** Couleur de texte courant dominante (corps, sinon tous les runs). */
  text: string | null;
  /** Couleur dominante des titres. */
  title: string | null;
  /** Couleurs chromatiques, de la plus fréquente à la moins fréquente. */
  accents: string[];
  /** Couleurs de texte, de la plus fréquente à la moins fréquente. */
  textColors: string[];
  headingFont: string | null;
  bodyFont: string | null;
  /** Au moins une couleur posée en dur (srgbClr, sysClr, prstClr), pas seulement des renvois au thème. */
  explicitColors: boolean;
  /** Au moins une police nommée en dur (pas +mj-lt / +mn-lt). */
  explicitFonts: boolean;
}

export interface UsageInput {
  theme: { colors: ThemeColors; fonts: ThemeFonts };
  masterXml: string | null;
  /** Layouts du masque, indexés par chemin de partie. */
  layouts: ReadonlyMap<string, string>;
  /** Diapositives, avec le chemin de leur layout (null s'il est inconnu). */
  slides: readonly { xml: string; layoutPart: string | null }[];
  /** Surface d'une diapositive en EMU² (cx × cy de p:sldSz). */
  slideArea: number;
}

// ---------------------------------------------------------------------------
// Couleurs
// ---------------------------------------------------------------------------

function rgbOf(hex: string): [number, number, number] {
  return [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255) as [number, number, number];
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  let rgb: [number, number, number];
  if (s === 0) rgb = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rgb = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** Saturation HSL (0..1). */
export function saturation(hex: string): number {
  return toHsl(hex)[1];
}

/** Couleur « de marque » : ni gris, ni quasi noire, ni quasi blanche. */
export function isChromatic(hex: string): boolean {
  const [, s, l] = toHsl(hex);
  return s >= 0.25 && l > 0.1 && l < 0.95;
}

const DEFAULT_CLR_MAP: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
const PRESET_COLORS: Record<string, string> = { black: "#000000", white: "#FFFFFF" };

interface ColorContext {
  theme: ThemeColors;
  clrMap: Record<string, string>;
}

interface ResolvedColor {
  hex: string;
  explicit: boolean;
}

const COLOR_OPEN_RE = new RegExp(`<(${NS})(srgbClr|schemeClr|sysClr|prstClr)\\b([^<>]*?)(/?)>`);

/** Première couleur d'un fragment (contenu d'un a:solidFill, d'un p:bgRef…). */
function resolveColor(fragment: string, ctx: ColorContext): ResolvedColor | null {
  const m = COLOR_OPEN_RE.exec(fragment);
  if (!m) return null;
  const [tag, prefix = "", kind, attrs = "", selfClosing] = m;
  let children = "";
  if (!selfClosing) {
    const from = m.index + tag.length;
    const at = fragment.indexOf(`</${prefix}${kind}>`, from);
    children = at < 0 ? "" : fragment.slice(from, at);
  }
  const val = attr(attrs, "val");
  let hex: string | null = null;
  let explicit = true;
  if (kind === "srgbClr") hex = hexOf(val);
  else if (kind === "sysClr") hex = hexOf(attr(attrs, "lastClr"));
  else if (kind === "prstClr") hex = val ? (PRESET_COLORS[val] ?? null) : null;
  else if (val) {
    explicit = false;
    // Propriétés propres seulement : `bg1="constructor"` ne doit pas renvoyer une fonction héritée.
    const slot = ownString(ctx.clrMap, val) ?? ownString(DEFAULT_CLR_MAP, val) ?? val;
    const themed = ownString(ctx.theme, slot);
    hex = themed && /^#[0-9A-F]{6}$/i.test(themed) ? themed : null;
  }
  if (!hex) return null;

  const mod = (name: string): number | null => {
    const tag = new RegExp(`<${NS}${name}\\b[^<>]*>`).exec(children)?.[0];
    const v = tag ? Number(attr(tag, "val")) : NaN;
    return Number.isFinite(v) ? v / 100_000 : null;
  };
  const lumMod = mod("lumMod");
  const lumOff = mod("lumOff");
  if (lumMod !== null || lumOff !== null) {
    const [h, s, l] = toHsl(hex);
    hex = fromHsl(h, s, Math.min(1, Math.max(0, l * (lumMod ?? 1) + (lumOff ?? 0))));
  }
  return { hex, explicit };
}

// ---------------------------------------------------------------------------
// Thème Office par défaut
// ---------------------------------------------------------------------------

/** Accents 1 à 6 des thèmes « Office » livrés par Microsoft. */
const OFFICE_PALETTES: readonly (readonly string[])[] = [
  // Office 2013-2022
  ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"],
  // Office 2013-2016 (première version du thème 2013)
  ["#5B9BD5", "#ED7D31", "#A5A5A5", "#FFC000", "#4472C4", "#70AD47"],
  // Office 2007-2010
  ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646"],
  // Office 2023+
  ["#156082", "#E97132", "#196B24", "#0F9ED5", "#A02B93", "#4EA72E"],
];

/** Couples (titres, corps) des thèmes Office livrés par Microsoft. */
const OFFICE_FONTS: readonly (readonly [string, string])[] = [
  ["calibri light", "calibri"],
  ["calibri", "calibri"],
  ["cambria", "calibri"],
  ["aptos display", "aptos"],
  ["aptos", "aptos"],
];

export function detectOfficeDefault(colors: ThemeColors, fonts: ThemeFonts): { colors: boolean; fonts: boolean } {
  const accents = [1, 2, 3, 4, 5, 6].map((i) => colors[`accent${i}`]?.toUpperCase());
  const colorsDefault = OFFICE_PALETTES.some((p) => p.every((c, i) => accents[i] === c));
  const major = fonts.major?.trim().toLowerCase();
  const minor = fonts.minor?.trim().toLowerCase();
  const fontsDefault = OFFICE_FONTS.some(([mj, mn]) => major === mj && minor === mn);
  return { colors: colorsDefault, fonts: fontsDefault };
}

// ---------------------------------------------------------------------------
// Comptage
// ---------------------------------------------------------------------------

class Tally {
  private readonly counts = new Map<string, number>();
  add(key: string, weight = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + weight);
  }
  /** Clés par poids décroissant ; à égalité, l'ordre de première apparition (déterministe). */
  ranked(): string[] {
    return [...this.counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }
  top(): string | null {
    return this.ranked()[0] ?? null;
  }
}

interface Tallies {
  background: Tally;
  bodyText: Tally;
  titleText: Tally;
  allText: Tally;
  accents: Tally;
  headingFont: Tally;
  bodyFont: Tally;
  explicitColors: boolean;
  explicitFonts: boolean;
}

const NOISE = ["style", "effectLst", "effectDag", "ln", "highlight", "uFill", "uLn"] as const;

/** Retire ce qui ne reflète pas la charte : effets, contours, styles par défaut, surlignage, soulignement. */
function stripNoise(xml: string): string {
  return NOISE.reduce(withoutElements, xml);
}

function cSldOf(xml: string): string {
  return firstInner(xml, "cSld") ?? "";
}

function fillOf(fragment: string, ctx: ColorContext): ResolvedColor | null {
  const inner = firstInner(fragment, "solidFill");
  return inner ? resolveColor(inner, ctx) : null;
}

/** Fond déclaré par une partie (p:bg → p:bgPr/a:solidFill ou p:bgRef). */
function backgroundOf(cSld: string, ctx: ColorContext): ResolvedColor | null {
  const bg = firstInner(cSld, "bg");
  if (!bg) return null;
  const bgPr = firstInner(bg, "bgPr");
  if (bgPr !== null) return fillOf(bgPr, ctx);
  const bgRef = firstInner(bg, "bgRef");
  return bgRef ? resolveColor(bgRef, ctx) : null;
}

function fontOf(rPr: string, fonts: ThemeFonts): { name: string; explicit: boolean } | null {
  const tag = new RegExp(`<${NS}latin\\b[^<>]*>`).exec(rPr)?.[0];
  const face = tag ? attr(tag, "typeface")?.trim() : null;
  if (!face) return null;
  if (face === "+mj-lt") return fonts.major ? { name: fonts.major, explicit: false } : null;
  if (face === "+mn-lt") return fonts.minor ? { name: fonts.minor, explicit: false } : null;
  if (face.startsWith("+")) return null;
  return { name: face, explicit: true };
}

const TEXT_RE = new RegExp(`<${NS}t(?:\\s[^<>]*)?>([^<]*)</${NS}t>`, "g");

function tallyRuns(fragment: string, isTitleShape: boolean, ctx: ColorContext, fonts: ThemeFonts, t: Tallies): void {
  for (const r of elements(fragment, "r")) {
    const body = r.inner ?? "";
    let chars = 0;
    for (const tm of body.matchAll(TEXT_RE)) chars += decodeEntities(tm[1] ?? "").trim().length;
    if (chars === 0) continue;
    const rPr = elements(body, "rPr").next().value;
    const size = Number(rPr ? attr(rPr.attrs, "sz") : NaN);
    const isTitle = isTitleShape || (Number.isFinite(size) && size >= 2400);
    const inner = rPr?.inner ?? "";

    const color = fillOf(inner, ctx);
    if (color) {
      t.explicitColors ||= color.explicit;
      t.allText.add(color.hex, chars);
      (isTitle ? t.titleText : t.bodyText).add(color.hex, chars);
      if (isChromatic(color.hex)) t.accents.add(color.hex);
    }
    const font = fontOf(inner, fonts);
    if (font) {
      t.explicitFonts ||= font.explicit;
      (isTitle ? t.headingFont : t.bodyFont).add(font.name, chars);
    }
  }
}

const EXT_RE = new RegExp(`<${NS}ext\\b[^<>]*>`);
const PH_RE = new RegExp(`<${NS}ph\\b[^<>]*>`);

function tallyShapes(
  cSld: string,
  opts: { skipPlaceholders: boolean; slideArea: number },
  ctx: ColorContext,
  fonts: ThemeFonts,
  t: Tallies,
): void {
  for (const el of elements(cSld, "sp")) {
    const sp = el.inner ?? "";
    const ph = PH_RE.exec(sp)?.[0];
    if (ph && opts.skipPlaceholders) continue;
    const phType = ph ? attr(ph, "type") : null;

    const spPr = firstInner(sp, "spPr") ?? "";
    const fill = fillOf(spPr, ctx);
    if (fill) {
      t.explicitColors ||= fill.explicit;
      if (isChromatic(fill.hex)) t.accents.add(fill.hex);
      const ext = EXT_RE.exec(firstInner(spPr, "xfrm") ?? "")?.[0];
      const area = ext ? Number(attr(ext, "cx")) * Number(attr(ext, "cy")) : 0;
      if (opts.slideArea > 0 && area >= 0.6 * opts.slideArea) t.background.add(fill.hex);
    }
    tallyRuns(sp, phType === "title" || phType === "ctrTitle", ctx, fonts, t);
  }
  // Tableaux (et autres cadres) : fonds de cellules et texte.
  for (const el of elements(cSld, "graphicFrame")) {
    const frame = el.inner ?? "";
    for (const c of elements(frame, "tcPr")) {
      const fill = fillOf(c.inner ?? "", ctx);
      if (!fill) continue;
      t.explicitColors ||= fill.explicit;
      if (isChromatic(fill.hex)) t.accents.add(fill.hex);
    }
    tallyRuns(frame, false, ctx, fonts, t);
  }
}

/** La valeur propre (non héritée du prototype) d'une table, si c'est une chaîne. */
function ownString(table: Partial<Record<string, string>>, key: string): string | undefined {
  if (!Object.hasOwn(table, key)) return undefined;
  const value = table[key];
  return typeof value === "string" ? value : undefined;
}

function clrMapOf(masterXml: string | null): Record<string, string> {
  const tag = masterXml ? new RegExp(`<${NS}clrMap\\b[^<>]*>`).exec(masterXml)?.[0] : undefined;
  const map: Record<string, string> = { ...DEFAULT_CLR_MAP };
  if (!tag) return map;
  for (const key of ["bg1", "tx1", "bg2", "tx2"]) {
    const v = attr(tag, key);
    if (v) map[key] = v;
  }
  return map;
}

export function analyzeUsage(input: UsageInput): ThemeUsage {
  const { fonts } = input.theme;
  const ctx: ColorContext = { theme: input.theme.colors, clrMap: clrMapOf(input.masterXml) };
  const t: Tallies = {
    background: new Tally(),
    bodyText: new Tally(),
    titleText: new Tally(),
    allText: new Tally(),
    accents: new Tally(),
    headingFont: new Tally(),
    bodyFont: new Tally(),
    explicitColors: false,
    explicitFonts: false,
  };

  const masterCSld = input.masterXml ? stripNoise(cSldOf(input.masterXml)) : "";
  const masterBg = backgroundOf(masterCSld, ctx);
  tallyShapes(masterCSld, { skipPlaceholders: true, slideArea: 0 }, ctx, fonts, t);

  const layoutBg = new Map<string, ResolvedColor | null>();
  for (const [part, xml] of input.layouts) {
    const cSld = stripNoise(cSldOf(xml));
    layoutBg.set(part, backgroundOf(cSld, ctx));
    tallyShapes(cSld, { skipPlaceholders: true, slideArea: 0 }, ctx, fonts, t);
  }

  for (const slide of input.slides) {
    const cSld = stripNoise(cSldOf(slide.xml));
    const bg = backgroundOf(cSld, ctx) ?? (slide.layoutPart ? layoutBg.get(slide.layoutPart) : null) ?? masterBg;
    if (bg) {
      t.explicitColors ||= bg.explicit;
      t.background.add(bg.hex);
    }
    tallyShapes(cSld, { skipPlaceholders: false, slideArea: input.slideArea }, ctx, fonts, t);
  }

  const headingFont = t.headingFont.top();
  const bodyFont = t.bodyFont.top();
  return {
    background: t.background.top(),
    text: t.bodyText.top() ?? t.allText.top(),
    title: t.titleText.top(),
    accents: t.accents.ranked(),
    textColors: t.allText.ranked(),
    headingFont,
    bodyFont,
    explicitColors: t.explicitColors,
    explicitFonts: t.explicitFonts,
  };
}
