import type { SafeFont } from "./fonts";
import type { PromptTemplate, SlideLayout } from "./schemas";

/**
 * Typographie et géométrie des diapos — fonctions pures partagées par l'export
 * .pptx et l'aperçu à l'écran (1 pt ≈ 0,139 cqw pour une diapo de 10 pouces).
 *
 * Principe : on estime la hauteur qu'occupe un texte (retour à la ligne mot à
 * mot, largeur moyenne des caractères, interligne, espacement de paragraphe)
 * et on retient la plus grande taille qui tient dans la zone, sans descendre
 * sous MIN_BODY_FONT_PT. Les zones sont dimensionnées pour que le pire cas du
 * schéma (6 puces × 180 caractères, titre de 140) tienne à 12 pt.
 */

export type SlideFormat = PromptTemplate["format"];

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Largeur de diapo (pouces), identique dans les deux formats. */
export const SLIDE_WIDTH_IN = 10;
export const SLIDE_MARGIN_IN = 0.5;
/** Largeur réservée au logo à droite du titre (présent ou non, pour un rendu stable). */
export const LOGO_RESERVED_IN = 1.5;
export const LOGO_BOX_IN = { w: 1.3, h: 0.6 } as const;
/** Bas de la zone de texte : laisse la place au pied de page. */
export const FOOTER_RESERVED_IN = 0.42;

export const MIN_BODY_FONT_PT = 12;
export const MIN_TITLE_FONT_PT = 16;

export const BODY_LINE_SPACING = 1.15;
export const TITLE_LINE_SPACING = 1.1;
/** Espace après chaque puce, en fraction de la taille de police. */
export const PARA_SPACE_RATIO = 0.45;
/** Retrait de la puce, en fraction de la taille de police (points). */
export const BULLET_INDENT_RATIO = 0.9;
/** Marge intérieure des zones de texte (points, chaque côté). */
export const TEXT_INSET_PT = 3.6;

export function slideHeightIn(format: SlideFormat): number {
  return format === "16:9" ? 5.625 : 7.5;
}

/** Points → pouces. */
const pt = (points: number): number => points / 72;

/**
 * Largeur moyenne d'un caractère (texte courant, espaces compris) en fraction
 * de la taille de police. Valeur par défaut : moyenne des polices autorisées.
 */
const CHAR_WIDTH: Record<SafeFont, number> = {
  Arial: 0.52,
  Calibri: 0.48,
  Montserrat: 0.58,
  "Open Sans": 0.55,
  Roboto: 0.52,
  Lato: 0.51,
  Poppins: 0.58,
  Verdana: 0.6,
  "Trebuchet MS": 0.53,
  Georgia: 0.53,
  "Times New Roman": 0.47,
};
const DEFAULT_CHAR_WIDTH = 0.52;
const BOLD_FACTOR = 1.1;

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlideGeometry {
  title: Box;
  subtitle: Box | null;
  /** Une zone (ou deux pour "two-columns"). */
  body: Box[];
  /** Section : intercalaire aéré (true) ou mise en page compacte quand le texte est long. */
  hero: boolean;
}

/** Répartit les puces sur deux colonnes (la première prend l'excédent). */
export function splitColumns<T>(bullets: T[]): [T[], T[]] {
  const half = Math.ceil(bullets.length / 2);
  return [bullets.slice(0, half), bullets.slice(half)];
}

const HEADER_TITLE_H = 1.0;
const HEADER_SUBTITLE_Y = 1.45;
const HEADER_SUBTITLE_H = 0.45;
const COLUMN_GAP_IN = 0.8;
const SECTION_BAR_IN = 0.35;

function headerLayout(format: SlideFormat, hasSubtitle: boolean, x: number, columns: 1 | 2): SlideGeometry {
  const H = slideHeightIn(format);
  const right = SLIDE_WIDTH_IN - SLIDE_MARGIN_IN;
  const bodyTop = hasSubtitle ? HEADER_SUBTITLE_Y + HEADER_SUBTITLE_H + 0.1 : HEADER_SUBTITLE_Y + 0.1;
  const h = H - bodyTop - FOOTER_RESERVED_IN;
  const w = right - x;
  const body =
    columns === 1
      ? [{ x, y: bodyTop, w, h }]
      : [
          { x, y: bodyTop, w: (w - COLUMN_GAP_IN) / 2, h },
          { x: x + (w + COLUMN_GAP_IN) / 2, y: bodyTop, w: (w - COLUMN_GAP_IN) / 2, h },
        ];
  return {
    title: { x, y: 0.3, w: right - x - LOGO_RESERVED_IN, h: HEADER_TITLE_H },
    subtitle: hasSubtitle ? { x, y: HEADER_SUBTITLE_Y, w, h: HEADER_SUBTITLE_H } : null,
    body,
    hero: false,
  };
}

function sectionHero(format: SlideFormat, hasSubtitle: boolean): SlideGeometry {
  const H = slideHeightIn(format);
  const x = SECTION_BAR_IN + 0.55;
  const w = SLIDE_WIDTH_IN - SLIDE_MARGIN_IN - x;
  const titleY = H * 0.2;
  const titleH = H * 0.26;
  const subY = titleY + titleH + 0.1;
  const bodyY = subY + (hasSubtitle ? 0.6 : 0);
  return {
    title: { x, y: titleY, w, h: titleH },
    subtitle: hasSubtitle ? { x, y: subY, w, h: 0.5 } : null,
    body: [{ x, y: bodyY, w, h: H - bodyY - FOOTER_RESERVED_IN }],
    hero: true,
  };
}

/**
 * Zones d'une diapo. Pour "section", `bullets` décide entre l'intercalaire
 * aéré et la mise en page compacte (si le texte ne tient pas à 14 pt).
 */
export function slideGeometry(
  layout: SlideLayout,
  format: SlideFormat,
  hasSubtitle: boolean,
  bullets: string[] = [],
): SlideGeometry {
  const H = slideHeightIn(format);
  switch (layout) {
    case "title":
      return {
        title: { x: 0.7, y: H * 0.22, w: SLIDE_WIDTH_IN - 1.4, h: H * 0.36 },
        subtitle: hasSubtitle ? { x: 0.7, y: H * 0.6, w: SLIDE_WIDTH_IN - 1.4, h: 0.8 } : null,
        body: [],
        hero: true,
      };
    case "content":
      return headerLayout(format, hasSubtitle, SLIDE_MARGIN_IN, 1);
    case "two-columns":
      return headerLayout(format, hasSubtitle, SLIDE_MARGIN_IN, 2);
    case "conclusion": {
      // Bandeau de titre plus haut : le corps commence un peu plus bas.
      const g = headerLayout(format, hasSubtitle, SLIDE_MARGIN_IN, 1);
      const shift = 0.2;
      return {
        ...g,
        subtitle: g.subtitle ? { ...g.subtitle, y: g.subtitle.y + shift } : null,
        body: g.body.map((b) => ({ ...b, y: b.y + shift, h: b.h - shift })),
      };
    }
    case "section": {
      const hero = sectionHero(format, hasSubtitle);
      const box = hero.body[0]!;
      // Décision indépendante de la police : l'aperçu et l'export choisissent la même mise en page.
      if (bullets.length === 0 || fits(bullets, 14, box, true)) return hero;
      return headerLayout(format, hasSubtitle, SECTION_BAR_IN + 0.4, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Estimation de hauteur
// ---------------------------------------------------------------------------

export interface TextEstimateOptions {
  bold?: boolean;
  /** Paragraphes à puces (retrait + espace après chaque paragraphe). */
  bullets?: boolean;
  font?: SafeFont;
  lineSpacing?: number;
}

/** Nombre de lignes d'un paragraphe, retour à la ligne mot à mot. */
export function wrapLines(paragraph: string, charsPerLine: number): number {
  const cpl = Math.max(1, Math.floor(charsPerLine));
  let lines = 1;
  let current = 0;
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    let len = word.length;
    if (current > 0 && current + 1 + len <= cpl) {
      current += 1 + len;
      continue;
    }
    if (current > 0) {
      lines += 1;
      current = 0;
    }
    // Mot plus long qu'une ligne : coupé.
    while (len > cpl) {
      lines += 1;
      len -= cpl;
    }
    current = len;
  }
  return lines;
}

/** Hauteur estimée (pouces) de paragraphes à une taille donnée, dans une zone de largeur `widthIn`. */
export function estimateTextHeightIn(
  paragraphs: string[],
  fontPt: number,
  widthIn: number,
  options: TextEstimateOptions = {},
): number {
  if (paragraphs.length === 0) return 0;
  const charW = pt(fontPt) * (options.font ? CHAR_WIDTH[options.font] : DEFAULT_CHAR_WIDTH) * (options.bold ? BOLD_FACTOR : 1);
  const indent = options.bullets ? pt(fontPt * BULLET_INDENT_RATIO) : 0;
  const usable = widthIn - indent - 2 * pt(TEXT_INSET_PT);
  const lineSpacing = options.lineSpacing ?? (options.bold ? TITLE_LINE_SPACING : BODY_LINE_SPACING);
  const lines = paragraphs.reduce((sum, p) => sum + wrapLines(p, usable / charW), 0);
  const paraSpace = options.bullets ? (paragraphs.length - 1) * pt(fontPt * PARA_SPACE_RATIO) : 0;
  return lines * pt(fontPt * lineSpacing) + paraSpace + 2 * pt(TEXT_INSET_PT);
}

function fits(paragraphs: string[], size: number, box: Box, bullets: boolean, font?: SafeFont, bold = false): boolean {
  return estimateTextHeightIn(paragraphs, size, box.w, { bullets, font, bold }) <= box.h;
}

/** Plus grande taille entre `max` et `min` (pas de 1 pt) qui tient ; `min` sinon. */
function largestFitting(max: number, min: number, ok: (size: number) => boolean): number {
  for (let size = max; size > min; size -= 1) {
    if (ok(size)) return size;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Tailles publiques
// ---------------------------------------------------------------------------

const TITLE_MAX_PT: Record<SlideLayout, number> = {
  title: 40,
  section: 36,
  content: 30,
  "two-columns": 30,
  conclusion: 30,
};

export interface SizingOptions {
  /** Police de la charte : affine la largeur moyenne des caractères. */
  font?: SafeFont;
  /** Section : les puces décident de la mise en page (aérée ou compacte), donc de la zone du titre. */
  bullets?: string[];
}

export function titleFontSizePt(
  title: string,
  layout: SlideLayout,
  format: SlideFormat,
  options: SizingOptions = {},
): number {
  const { font, bullets = [] } = options;
  const geo = slideGeometry(layout, format, false, bullets);
  const max = layout === "section" && !geo.hero ? TITLE_MAX_PT.content : TITLE_MAX_PT[layout];
  return largestFitting(max, MIN_TITLE_FONT_PT, (size) => fits([title], size, geo.title, false, font, true));
}

function bulletMaxPt(count: number, layout: SlideLayout): number {
  const base = count <= 3 ? 24 : count <= 5 ? 20 : 18;
  return layout === "section" ? Math.min(22, base) : base;
}

/**
 * Taille des puces : la plus grande qui tient dans la (les) zone(s) du layout.
 * Pour "two-columns", la même taille pour les deux colonnes, calculée sur la plus chargée.
 */
export function bulletFontSizePt(
  bullets: string[],
  layout: SlideLayout,
  format: SlideFormat,
  hasSubtitle: boolean,
  options: Pick<SizingOptions, "font"> = {},
): number {
  const { font } = options;
  if (bullets.length === 0) return bulletMaxPt(0, layout);
  const geo = slideGeometry(layout, format, hasSubtitle, bullets);
  if (geo.body.length === 0) return MIN_BODY_FONT_PT;
  const columns = geo.body.length === 2 ? splitColumns(bullets) : [bullets];
  return largestFitting(bulletMaxPt(bullets.length, layout), MIN_BODY_FONT_PT, (size) =>
    columns.every((col, i) => col.length === 0 || fits(col, size, geo.body[i]!, true, font)),
  );
}
