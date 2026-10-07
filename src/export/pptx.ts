import { createHash } from "node:crypto";
import { posix } from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { isSafeFont, type SafeFont } from "@/domain/fonts";
import { stripControlChars, type Brand, type DeckSpec, type PromptTemplate, type Slide } from "@/domain/schemas";
import {
  BODY_LINE_SPACING,
  bulletFontSizePt,
  BULLET_INDENT_RATIO,
  LOGO_BOX_IN,
  PARA_SPACE_RATIO,
  slideGeometry,
  slideHeightIn,
  SLIDE_MARGIN_IN,
  SLIDE_WIDTH_IN,
  splitColumns,
  TEXT_INSET_PT,
  TITLE_LINE_SPACING,
  titleFontSizePt,
  type Box,
  type SlideFormat,
} from "@/domain/typography";

/**
 * Export PowerPoint d'un deck, charte appliquée (fond, couleurs, polices, logo
 * en haut à droite, un seul fichier image pour toutes les diapos : cf.
 * dedupeMedia). Un rendu par layout ; notes d'orateur.
 *
 * Tailles et zones : src/domain/typography.ts (partagé avec l'aperçu écran),
 * qui garantit par calcul que le pire cas du schéma tient à 12 pt au moins.
 * `fit: "shrink"` reste un filet (pptxgenjs ne l'applique qu'à l'édition).
 *
 * Sûreté du XML : pptxgenjs échappe les textes des diapos et des notes, mais
 * pas tous les champs de métadonnées (ex. Company) ni les noms de police ; on
 * ne renseigne donc pas Company, les polices viennent d'une liste fermée, et
 * les caractères de contrôle (interdits en XML 1.0) sont retirés de tout texte,
 * même d'un deck qui n'aurait pas été validé.
 */

type Pptx = InstanceType<typeof PptxGenJS>;
type PptxSlide = ReturnType<Pptx["addSlide"]>;

const LAYOUT_NAME: Record<SlideFormat, "LAYOUT_16x9" | "LAYOUT_4x3"> = {
  "16:9": "LAYOUT_16x9",
  "4:3": "LAYOUT_4x3",
};

/** Couleur pptxgenjs : hex sans dièse, majuscules (une couleur invalide retombe sur le noir). */
const hex = (color: string): string => {
  const value = color.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(value) ? value : "000000";
};

const safeText = (value: string): string => stripControlChars(value);

/** Valeur d'attribut XML : caractères de contrôle retirés, & < > " ' échappés. */
function xmlAttr(value: string): string {
  return stripControlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const THEME_PATH = "ppt/theme/theme1.xml";
const CLR_SCHEME = /<a:clrScheme\b[^>]*>[\s\S]*?<\/a:clrScheme>/;

/**
 * Jeu de couleurs du thème PowerPoint aux couleurs de la charte : la palette de
 * PowerPoint (nouvelles formes, graphiques, SmartArt) suit la charte au lieu
 * des couleurs d'Office. dk1/lt1 = texte/fond, dk2 = primaire, accents 1-3 =
 * primaire, accent, secondaire ; accents 4-6 gardent ceux d'Office (aucune
 * couleur de charte à leur donner).
 */
export function brandColorScheme(brand: Brand): string {
  const c = brand.colors;
  const slot = (name: string, color: string) => `<a:${name}><a:srgbClr val="${hex(color)}"/></a:${name}>`;
  return (
    `<a:clrScheme name="${xmlAttr(brand.name)}">` +
    slot("dk1", c.text) +
    slot("lt1", c.background) +
    slot("dk2", c.primary) +
    slot("lt2", c.background) +
    slot("accent1", c.primary) +
    slot("accent2", c.accent) +
    slot("accent3", c.secondary) +
    `<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
    slot("hlink", c.primary) +
    slot("folHlink", c.secondary) +
    `</a:clrScheme>`
  );
}

/** Remplace le jeu de couleurs d'un theme1.xml (inchangé s'il n'en a pas). */
export function applyBrandColorScheme(themeXml: string, brand: Brand): string {
  return themeXml.replace(CLR_SCHEME, () => brandColorScheme(brand));
}

const MEDIA_DIR = "ppt/media/";
const RELATIONSHIP = /<Relationship\b[^>]*>/g;
const TARGET_ATTR = /\bTarget="([^"]*)"/;

/**
 * Fusionne les médias identiques de l'archive : pptxgenjs ne dédoublonne les
 * images que par chemin, si bien qu'un logo passé en data URL est recopié une
 * fois par diapo (20 diapos → 20 copies). On garde le premier fichier de
 * chaque contenu (octets + extension, qui fixe le type MIME via les `Default`
 * de [Content_Types].xml), on redirige vers lui la cible des relations
 * internes de tous les .rels, puis on retire les copies. Le XML des diapos
 * n'est pas touché (mêmes rId, même position, même ordre de superposition).
 */
export async function dedupeMedia(zip: JSZip): Promise<void> {
  const media = Object.keys(zip.files)
    .filter((name) => name.startsWith(MEDIA_DIR) && !zip.files[name]!.dir)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const kept = new Map<string, string>(); // empreinte → chemin conservé
  const replaced = new Map<string, string>(); // copie → chemin conservé
  for (const name of media) {
    const bytes = await zip.file(name)!.async("uint8array");
    const key = `${posix.extname(name).toLowerCase()}:${createHash("sha256").update(bytes).digest("hex")}`;
    const first = kept.get(key);
    if (first) replaced.set(name, first);
    else kept.set(key, name);
  }
  if (replaced.size === 0) return;

  for (const relsPath of Object.keys(zip.files).filter((name) => name.endsWith(".rels"))) {
    // Les cibles d'un ppt/slides/_rels/slide1.xml.rels sont relatives à ppt/slides/.
    const partDir = posix.dirname(posix.dirname(relsPath));
    const xml = await zip.file(relsPath)!.async("string");
    let changed = false;
    const next = xml.replace(RELATIONSHIP, (rel) => {
      if (/\bTargetMode="External"/.test(rel)) return rel;
      const target = TARGET_ATTR.exec(rel)?.[1];
      if (target === undefined) return rel;
      const canonical = replaced.get(posix.normalize(posix.join(partDir, target)));
      if (!canonical) return rel;
      changed = true;
      return rel.replace(TARGET_ATTR, () => `Target="${posix.relative(partDir, canonical)}"`);
    });
    if (changed) zip.file(relsPath, next);
  }
  for (const copy of replaced.keys()) zip.remove(copy);
}

/**
 * Post-traitement de l'archive produite par pptxgenjs : couleurs de la charte
 * dans le thème (pptxgenjs n'en expose que les polices) et médias dédoublonnés.
 */
async function finalizeArchive(pptx: Buffer, brand: Brand): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptx);
  const theme = zip.file(THEME_PATH);
  if (theme) zip.file(THEME_PATH, applyBrandColorScheme(await theme.async("string"), brand));
  await dedupeMedia(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
const safeFont = (value: string): SafeFont => (isSafeFont(value) ? value : "Arial");

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

interface Logo {
  data: string; // format pptxgenjs : "image/png;base64,…"
  w: number;
  h: number;
}

/** Dimensions intrinsèques d'un PNG ou d'un JPEG, lues dans l'en-tête. */
export function imageSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1] ?? 0;
      const length = bytes.readUInt16BE(i + 2);
      // SOF0..SOF15 hors DHT (C4), JPG (C8), DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + length;
    }
  }
  return null;
}

/**
 * Logo ajusté (sans déformation) dans LOGO_BOX_IN. Les logos SVG ne sont pas
 * exportés : pptxgenjs a besoin d'un canvas de navigateur pour leur aperçu PNG.
 */
function prepareLogo(dataUrl: string | null): Logo | null {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const [, mime, payload] = match;
  if (!mime || !payload) return null;
  const size = imageSize(Buffer.from(payload, "base64"));
  if (!size || size.w === 0 || size.h === 0) return null;
  const scale = Math.min(LOGO_BOX_IN.w / size.w, LOGO_BOX_IN.h / size.h);
  return { data: `${mime};base64,${payload}`, w: size.w * scale, h: size.h * scale };
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

interface Ctx {
  pptx: Pptx;
  format: SlideFormat;
  W: number;
  H: number;
  brand: Brand;
  heading: SafeFont;
  body: SafeFont;
  logo: Logo | null;
  deckTitle: string;
}

const boxOf = (b: Box) => ({ x: b.x, y: b.y, w: b.w, h: b.h });

function bulletRuns(bullets: string[], ctx: Ctx, fontSize: number, marker?: string): PptxGenJS.TextProps[] {
  const indent = fontSize * BULLET_INDENT_RATIO;
  return bullets.map((text) => ({
    text: safeText(text),
    options: {
      bullet: marker ? { characterCode: marker, indent } : { indent },
      breakLine: true,
      paraSpaceAfter: Math.round(fontSize * PARA_SPACE_RATIO),
      color: hex(ctx.brand.colors.text),
      fontFace: ctx.body,
      fontSize,
    },
  }));
}

function addBody(slide: PptxSlide, box: Box, bullets: string[], size: number, ctx: Ctx, marker?: string): void {
  if (bullets.length === 0) return;
  slide.addText(bulletRuns(bullets, ctx, size, marker), {
    ...boxOf(box),
    valign: "top",
    lineSpacingMultiple: BODY_LINE_SPACING,
    margin: TEXT_INSET_PT,
    fit: "shrink",
  });
}

function addTitle(slide: PptxSlide, s: Slide, box: Box, ctx: Ctx, color: string, valign: "top" | "middle" | "bottom"): void {
  slide.addText(safeText(s.title), {
    ...boxOf(box),
    fontFace: ctx.heading,
    fontSize: titleFontSizePt(s.title, s.layout, ctx.format, { font: ctx.heading, bullets: s.bullets }),
    bold: true,
    color,
    valign,
    lineSpacingMultiple: TITLE_LINE_SPACING,
    margin: TEXT_INSET_PT,
    fit: "shrink",
  });
}

function addSubtitle(slide: PptxSlide, s: Slide, box: Box | null, ctx: Ctx, color: string, size = 16): void {
  if (!box || !s.subtitle) return;
  slide.addText(safeText(s.subtitle), {
    ...boxOf(box),
    fontFace: ctx.body,
    fontSize: size,
    italic: true,
    color,
    valign: "top",
    margin: TEXT_INSET_PT,
    fit: "shrink",
  });
}

function addLogo(slide: PptxSlide, ctx: Ctx, onDark = false): void {
  if (!ctx.logo) return;
  const x = ctx.W - SLIDE_MARGIN_IN * 0.6 - ctx.logo.w;
  if (onDark) {
    // Pastille claire sous le logo pour qu'il reste lisible sur fond foncé.
    slide.addShape(ctx.pptx.ShapeType.roundRect, {
      x: x - 0.08,
      y: 0.22,
      w: ctx.logo.w + 0.16,
      h: ctx.logo.h + 0.16,
      fill: { color: hex(ctx.brand.colors.background) },
      line: { color: hex(ctx.brand.colors.background) },
      rectRadius: 0.08,
    });
  }
  slide.addImage({ data: ctx.logo.data, x, y: 0.3, w: ctx.logo.w, h: ctx.logo.h });
}

function addFooter(slide: PptxSlide, ctx: Ctx): void {
  const color = hex(ctx.brand.colors.secondary);
  slide.addText(safeText(ctx.deckTitle), {
    x: SLIDE_MARGIN_IN,
    y: ctx.H - 0.36,
    w: ctx.W - 2 * SLIDE_MARGIN_IN - 0.8,
    h: 0.26,
    fontFace: ctx.body,
    fontSize: 9,
    color,
    fit: "shrink",
    margin: 0,
  });
  slide.slideNumber = { x: ctx.W - SLIDE_MARGIN_IN - 0.6, y: ctx.H - 0.36, w: 0.6, h: 0.26, fontSize: 9, color, align: "right" };
}

function bar(slide: PptxSlide, ctx: Ctx, box: Box, color: string): void {
  slide.addShape(ctx.pptx.ShapeType.rect, { ...boxOf(box), fill: { color }, line: { color } });
}

function renderTitle(slide: PptxSlide, s: Slide, ctx: Ctx): void {
  const { brand } = ctx;
  const geo = slideGeometry("title", ctx.format, Boolean(s.subtitle));
  slide.background = { color: hex(brand.colors.primary) };
  bar(slide, ctx, { x: 0, y: ctx.H - 0.35, w: ctx.W, h: 0.35 }, hex(brand.colors.accent));
  addTitle(slide, s, geo.title, ctx, hex(brand.colors.background), "bottom");
  addSubtitle(slide, s, geo.subtitle, ctx, hex(brand.colors.background), 20);
  addLogo(slide, ctx, true);
}

function renderSection(slide: PptxSlide, s: Slide, ctx: Ctx): void {
  const { brand } = ctx;
  const geo = slideGeometry("section", ctx.format, Boolean(s.subtitle), s.bullets);
  slide.background = { color: hex(brand.colors.background) };
  bar(slide, ctx, { x: 0, y: 0, w: 0.35, h: ctx.H }, hex(brand.colors.primary));
  addTitle(slide, s, geo.title, ctx, hex(brand.colors.primary), geo.hero ? "bottom" : "middle");
  addSubtitle(slide, s, geo.subtitle, ctx, hex(brand.colors.secondary), geo.hero ? 20 : 16);
  const size = bulletFontSizePt(s.bullets, "section", ctx.format, Boolean(s.subtitle), { font: ctx.body });
  addBody(slide, geo.body[0]!, s.bullets, size, ctx);
  addLogo(slide, ctx);
  addFooter(slide, ctx);
}

function renderContent(slide: PptxSlide, s: Slide, ctx: Ctx): void {
  const { brand } = ctx;
  const geo = slideGeometry("content", ctx.format, Boolean(s.subtitle));
  slide.background = { color: hex(brand.colors.background) };
  addTitle(slide, s, geo.title, ctx, hex(brand.colors.primary), "middle");
  bar(slide, ctx, { x: SLIDE_MARGIN_IN, y: 1.35, w: 1.2, h: 0.06 }, hex(brand.colors.accent));
  addSubtitle(slide, s, geo.subtitle, ctx, hex(brand.colors.secondary));
  const size = bulletFontSizePt(s.bullets, "content", ctx.format, Boolean(s.subtitle), { font: ctx.body });
  addBody(slide, geo.body[0]!, s.bullets, size, ctx);
  addLogo(slide, ctx);
  addFooter(slide, ctx);
}

function renderTwoColumns(slide: PptxSlide, s: Slide, ctx: Ctx): void {
  const { brand } = ctx;
  const geo = slideGeometry("two-columns", ctx.format, Boolean(s.subtitle));
  slide.background = { color: hex(brand.colors.background) };
  addTitle(slide, s, geo.title, ctx, hex(brand.colors.primary), "middle");
  bar(slide, ctx, { x: SLIDE_MARGIN_IN, y: 1.35, w: 1.2, h: 0.06 }, hex(brand.colors.accent));
  addSubtitle(slide, s, geo.subtitle, ctx, hex(brand.colors.secondary));
  const size = bulletFontSizePt(s.bullets, "two-columns", ctx.format, Boolean(s.subtitle), { font: ctx.body });
  const [left, right] = splitColumns(s.bullets);
  addBody(slide, geo.body[0]!, left, size, ctx);
  addBody(slide, geo.body[1]!, right, size, ctx);
  if (right.length > 0) {
    const l = geo.body[0]!;
    const r = geo.body[1]!;
    slide.addShape(ctx.pptx.ShapeType.line, {
      x: (l.x + l.w + r.x) / 2,
      y: l.y + 0.1,
      w: 0,
      h: l.h - 0.2,
      line: { color: hex(brand.colors.secondary), width: 1 },
    });
  }
  addLogo(slide, ctx);
  addFooter(slide, ctx);
}

function renderConclusion(slide: PptxSlide, s: Slide, ctx: Ctx): void {
  const { brand } = ctx;
  const geo = slideGeometry("conclusion", ctx.format, Boolean(s.subtitle));
  slide.background = { color: hex(brand.colors.background) };
  bar(slide, ctx, { x: 0, y: 0, w: ctx.W, h: 1.5 }, hex(brand.colors.primary));
  addTitle(slide, s, geo.title, ctx, hex(brand.colors.background), "middle");
  addSubtitle(slide, s, geo.subtitle, ctx, hex(brand.colors.secondary));
  const size = bulletFontSizePt(s.bullets, "conclusion", ctx.format, Boolean(s.subtitle), { font: ctx.body });
  // Puces « ✓ » : la synthèse se distingue du corps du deck.
  addBody(slide, geo.body[0]!, s.bullets, size, ctx, "2713");
  addLogo(slide, ctx, true);
  addFooter(slide, ctx);
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export async function deckToPptx(deck: DeckSpec, brand: Brand, template: PromptTemplate): Promise<Buffer> {
  const pptx = new PptxGenJS();
  const format = template.format;
  pptx.layout = LAYOUT_NAME[format];
  // Métadonnées : title/subject/author sont échappés par pptxgenjs ; Company ne l'est
  // pas, on ne le renseigne donc pas.
  pptx.title = safeText(deck.title);
  pptx.subject = safeText(deck.subtitle);
  pptx.author = "Grand Oral Studio";

  const heading = safeFont(brand.fonts.heading);
  const body = safeFont(brand.fonts.body);
  pptx.theme = { headFontFace: heading, bodyFontFace: body };

  const ctx: Ctx = {
    pptx,
    format,
    W: SLIDE_WIDTH_IN,
    H: slideHeightIn(format),
    brand,
    heading,
    body,
    logo: prepareLogo(brand.logoDataUrl),
    deckTitle: deck.title,
  };

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    switch (s.layout) {
      case "title":
        renderTitle(slide, s, ctx);
        break;
      case "section":
        renderSection(slide, s, ctx);
        break;
      case "two-columns":
        renderTwoColumns(slide, s, ctx);
        break;
      case "conclusion":
        renderConclusion(slide, s, ctx);
        break;
      case "content":
        renderContent(slide, s, ctx);
        break;
    }
    const notes = safeText(s.notes);
    if (notes) slide.addNotes(notes);
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  let buffer: Buffer;
  if (Buffer.isBuffer(out)) buffer = out;
  else if (out instanceof Uint8Array) buffer = Buffer.from(out);
  else if (out instanceof ArrayBuffer) buffer = Buffer.from(new Uint8Array(out));
  else throw new Error("pptxgenjs n'a pas produit de tampon binaire.");
  return finalizeArchive(buffer, brand);
}
