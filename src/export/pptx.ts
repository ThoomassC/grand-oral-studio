import PptxGenJS from "pptxgenjs";
import type { Brand, DeckSpec, PromptTemplate, Slide } from "@/domain/schemas";

/**
 * Export PowerPoint d'un deck, charte appliquée (fond, couleurs, polices, logo
 * en haut à droite). Un rendu par layout ; notes d'orateur ; tailles de police
 * calculées d'après la quantité de texte pour éviter les débordements (l'option
 * `fit: "shrink"` de pptxgenjs n'agit qu'à l'édition dans PowerPoint, elle ne
 * sert ici que de filet). L'échappement XML (&, <, ', …) est assuré par
 * pptxgenjs sur tous les textes.
 */

type Pptx = InstanceType<typeof PptxGenJS>;
type PptxSlide = ReturnType<Pptx["addSlide"]>;

interface Geometry {
  layout: "LAYOUT_16x9" | "LAYOUT_4x3";
  w: number;
  h: number;
}

const GEOMETRY: Record<PromptTemplate["format"], Geometry> = {
  "16:9": { layout: "LAYOUT_16x9", w: 10, h: 5.625 },
  "4:3": { layout: "LAYOUT_4x3", w: 10, h: 7.5 },
};

const MARGIN = 0.5;
const LOGO_BOX = { w: 1.3, h: 0.6 };

/** Couleur pptxgenjs : hex sans dièse, majuscules. */
const hex = (color: string): string => color.replace(/^#/, "").toUpperCase();

// ---------------------------------------------------------------------------
// Dimensionnement du texte
// ---------------------------------------------------------------------------

/** Taille du titre selon sa longueur. */
export function titleFontSize(title: string, big = false): number {
  const n = title.length;
  const base = big ? 40 : 30;
  if (n <= 35) return base;
  if (n <= 60) return base - 6;
  if (n <= 100) return base - 10;
  return base - 14;
}

/**
 * Taille des puces selon leur nombre et le volume de texte rapporté à la
 * surface disponible (en pouces carrés).
 */
export function bulletFontSize(bullets: string[], areaSqIn: number): number {
  if (bullets.length === 0) return 20;
  const chars = bullets.reduce((sum, b) => sum + b.length, 0);
  // ≈ capacité en caractères d'un pouce carré à 20 pt (avec interlignage) : ~30.
  const density = (chars + bullets.length * 15) / Math.max(1, areaSqIn);
  let size = bullets.length <= 3 ? 24 : bullets.length <= 5 ? 20 : 18;
  if (density > 12) size -= 2;
  if (density > 18) size -= 2;
  if (density > 26) size -= 2;
  if (density > 36) size -= 2;
  return Math.max(11, size);
}

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
 * Prépare le logo, ajusté (sans déformation) dans la boîte LOGO_BOX.
 * Les logos SVG ne sont pas exportés : pptxgenjs a besoin d'un canvas de
 * navigateur pour en produire l'aperçu PNG, indisponible côté serveur.
 */
function prepareLogo(dataUrl: string | null): Logo | null {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const [, mime, payload] = match;
  if (!mime || !payload) return null;
  const size = imageSize(Buffer.from(payload, "base64"));
  if (!size || size.w === 0 || size.h === 0) return null;
  const scale = Math.min(LOGO_BOX.w / size.w, LOGO_BOX.h / size.h);
  return { data: `${mime};base64,${payload}`, w: size.w * scale, h: size.h * scale };
}

// ---------------------------------------------------------------------------
// Rendu par layout
// ---------------------------------------------------------------------------

interface Ctx {
  pptx: Pptx;
  geo: Geometry;
  brand: Brand;
  logo: Logo | null;
}

function bulletRuns(bullets: string[], ctx: Ctx, fontSize: number, marker?: string): PptxGenJS.TextProps[] {
  return bullets.map((text) => ({
    text,
    options: {
      bullet: marker ? { characterCode: marker, indent: fontSize * 0.9 } : { indent: fontSize * 0.9 },
      breakLine: true,
      paraSpaceAfter: Math.round(fontSize * 0.45),
      color: hex(ctx.brand.colors.text),
      fontFace: ctx.brand.fonts.body,
      fontSize,
    },
  }));
}

function addLogo(slide: PptxSlide, ctx: Ctx, onDark = false): void {
  if (!ctx.logo) return;
  const x = ctx.geo.w - MARGIN * 0.6 - ctx.logo.w;
  if (onDark) {
    // Pastille claire sous le logo pour qu'il reste lisible sur un fond foncé.
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

/** Zone réservée au logo à droite du titre. */
const titleWidth = (ctx: Ctx): number => ctx.geo.w - 2 * MARGIN - (ctx.logo ? LOGO_BOX.w + 0.2 : 0);

function addHeader(slide: PptxSlide, s: Slide, ctx: Ctx): number {
  const { brand } = ctx;
  slide.addText(s.title, {
    x: MARGIN,
    y: 0.3,
    w: titleWidth(ctx),
    h: 0.9,
    fontFace: brand.fonts.heading,
    fontSize: titleFontSize(s.title),
    bold: true,
    color: hex(brand.colors.primary),
    valign: "middle",
    fit: "shrink",
    margin: 0,
  });
  slide.addShape(ctx.pptx.ShapeType.rect, {
    x: MARGIN,
    y: 1.25,
    w: 1.2,
    h: 0.06,
    fill: { color: hex(brand.colors.accent) },
    line: { color: hex(brand.colors.accent) },
  });
  let y = 1.45;
  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: MARGIN,
      y,
      w: ctx.geo.w - 2 * MARGIN,
      h: 0.45,
      fontFace: brand.fonts.body,
      fontSize: 16,
      italic: true,
      color: hex(brand.colors.secondary),
      fit: "shrink",
      margin: 0,
    });
    y += 0.5;
  }
  return y;
}

function addFooter(slide: PptxSlide, deckTitle: string, ctx: Ctx, onDark = false): void {
  const color = hex(onDark ? ctx.brand.colors.background : ctx.brand.colors.secondary);
  slide.addText(deckTitle, {
    x: MARGIN,
    y: ctx.geo.h - 0.4,
    w: ctx.geo.w - 2 * MARGIN - 0.8,
    h: 0.3,
    fontFace: ctx.brand.fonts.body,
    fontSize: 9,
    color,
    fit: "shrink",
    margin: 0,
  });
  slide.slideNumber = { x: ctx.geo.w - MARGIN - 0.6, y: ctx.geo.h - 0.4, w: 0.6, h: 0.3, fontSize: 9, color, align: "right" };
}

function renderTitle(slide: PptxSlide, s: Slide, ctx: Ctx): void {
  const { brand, geo } = ctx;
  slide.background = { color: hex(brand.colors.primary) };
  slide.addShape(ctx.pptx.ShapeType.rect, {
    x: 0,
    y: geo.h - 0.35,
    w: geo.w,
    h: 0.35,
    fill: { color: hex(brand.colors.accent) },
    line: { color: hex(brand.colors.accent) },
  });
  slide.addText(s.title, {
    x: MARGIN + 0.2,
    y: geo.h * 0.28,
    w: geo.w - 2 * MARGIN - 0.4,
    h: geo.h * 0.3,
    fontFace: brand.fonts.heading,
    fontSize: titleFontSize(s.title, true),
    bold: true,
    color: hex(brand.colors.background),
    valign: "bottom",
    fit: "shrink",
    margin: 0,
  });
  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: MARGIN + 0.2,
      y: geo.h * 0.6,
      w: geo.w - 2 * MARGIN - 0.4,
      h: 0.7,
      fontFace: brand.fonts.body,
      fontSize: 20,
      color: hex(brand.colors.background),
      valign: "top",
      fit: "shrink",
      margin: 0,
    });
  }
  addLogo(slide, ctx, true);
}

function renderSection(slide: PptxSlide, s: Slide, deckTitle: string, ctx: Ctx): void {
  const { brand, geo } = ctx;
  slide.background = { color: hex(brand.colors.background) };
  slide.addShape(ctx.pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.35,
    h: geo.h,
    fill: { color: hex(brand.colors.primary) },
    line: { color: hex(brand.colors.primary) },
  });
  slide.addText(s.title, {
    x: MARGIN + 0.4,
    y: geo.h * 0.3,
    w: geo.w - 2 * MARGIN - 0.4,
    h: geo.h * 0.25,
    fontFace: brand.fonts.heading,
    fontSize: titleFontSize(s.title, true),
    bold: true,
    color: hex(brand.colors.primary),
    valign: "bottom",
    fit: "shrink",
    margin: 0,
  });
  const lines = [s.subtitle, ...s.bullets].filter((t) => t.length > 0);
  if (lines.length > 0) {
    const h = geo.h * 0.3;
    const size = Math.min(20, bulletFontSize(lines, (geo.w - 2 * MARGIN) * h));
    slide.addText(
      lines.map((text) => ({ text, options: { breakLine: true, paraSpaceAfter: 6 } })),
      {
        x: MARGIN + 0.4,
        y: geo.h * 0.58,
        w: geo.w - 2 * MARGIN - 0.4,
        h,
        fontFace: brand.fonts.body,
        fontSize: size,
        color: hex(brand.colors.secondary),
        valign: "top",
        fit: "shrink",
        margin: 0,
      },
    );
  }
  addLogo(slide, ctx);
  addFooter(slide, deckTitle, ctx);
}

function renderContent(slide: PptxSlide, s: Slide, deckTitle: string, ctx: Ctx): void {
  const { brand, geo } = ctx;
  slide.background = { color: hex(brand.colors.background) };
  const top = addHeader(slide, s, ctx);
  const h = geo.h - top - 0.6;
  const w = geo.w - 2 * MARGIN;
  if (s.bullets.length > 0) {
    const size = bulletFontSize(s.bullets, w * h);
    slide.addText(bulletRuns(s.bullets, ctx, size), {
      x: MARGIN,
      y: top + 0.1,
      w,
      h,
      valign: "top",
      fit: "shrink",
      margin: 4,
    });
  }
  addLogo(slide, ctx);
  addFooter(slide, deckTitle, ctx);
}

function renderTwoColumns(slide: PptxSlide, s: Slide, deckTitle: string, ctx: Ctx): void {
  const { brand, geo } = ctx;
  slide.background = { color: hex(brand.colors.background) };
  const top = addHeader(slide, s, ctx);
  const h = geo.h - top - 0.6;
  const gap = 0.8;
  const colW = (geo.w - 2 * MARGIN - gap) / 2;
  const half = Math.ceil(s.bullets.length / 2);
  const columns = [s.bullets.slice(0, half), s.bullets.slice(half)];
  // Même taille pour les deux colonnes, calculée sur la plus chargée.
  const size = Math.min(...columns.map((c) => bulletFontSize(c, colW * h)));
  columns.forEach((bullets, i) => {
    if (bullets.length === 0) return;
    const x = MARGIN + i * (colW + gap);
    slide.addText(bulletRuns(bullets, ctx, size), { x, y: top + 0.1, w: colW, h, valign: "top", fit: "shrink", margin: 4 });
  });
  slide.addShape(ctx.pptx.ShapeType.line, {
    x: MARGIN + colW + gap / 2,
    y: top + 0.2,
    w: 0,
    h: h - 0.3,
    line: { color: hex(brand.colors.secondary), width: 1 },
  });
  addLogo(slide, ctx);
  addFooter(slide, deckTitle, ctx);
}

function renderConclusion(slide: PptxSlide, s: Slide, deckTitle: string, ctx: Ctx): void {
  const { brand, geo } = ctx;
  slide.background = { color: hex(brand.colors.background) };
  slide.addShape(ctx.pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: geo.w,
    h: 1.45,
    fill: { color: hex(brand.colors.primary) },
    line: { color: hex(brand.colors.primary) },
  });
  slide.addText(s.title, {
    x: MARGIN,
    y: 0.3,
    w: titleWidth(ctx),
    h: 0.9,
    fontFace: brand.fonts.heading,
    fontSize: titleFontSize(s.title),
    bold: true,
    color: hex(brand.colors.background),
    valign: "middle",
    fit: "shrink",
    margin: 0,
  });
  let top = 1.7;
  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: MARGIN,
      y: top,
      w: geo.w - 2 * MARGIN,
      h: 0.45,
      fontFace: brand.fonts.body,
      fontSize: 16,
      italic: true,
      color: hex(brand.colors.secondary),
      fit: "shrink",
      margin: 0,
    });
    top += 0.5;
  }
  if (s.bullets.length > 0) {
    const w = geo.w - 2 * MARGIN;
    const h = geo.h - top - 0.6;
    const size = bulletFontSize(s.bullets, w * h);
    // Puces « ✓ » : la synthèse se distingue du corps du deck.
    slide.addText(bulletRuns(s.bullets, ctx, size, "2713"), { x: MARGIN, y: top, w, h, valign: "top", fit: "shrink", margin: 4 });
  }
  addLogo(slide, ctx, true);
  addFooter(slide, deckTitle, ctx);
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export async function deckToPptx(deck: DeckSpec, brand: Brand, template: PromptTemplate): Promise<Buffer> {
  const pptx = new PptxGenJS();
  const geo = GEOMETRY[template.format];
  pptx.layout = geo.layout;
  pptx.title = deck.title;
  pptx.subject = deck.subtitle;
  pptx.company = brand.name;
  pptx.author = "Grand Oral Studio";
  pptx.theme = { headFontFace: brand.fonts.heading, bodyFontFace: brand.fonts.body };

  const ctx: Ctx = { pptx, geo, brand, logo: prepareLogo(brand.logoDataUrl) };

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    switch (s.layout) {
      case "title":
        renderTitle(slide, s, ctx);
        break;
      case "section":
        renderSection(slide, s, deck.title, ctx);
        break;
      case "two-columns":
        renderTwoColumns(slide, s, deck.title, ctx);
        break;
      case "conclusion":
        renderConclusion(slide, s, deck.title, ctx);
        break;
      case "content":
        renderContent(slide, s, deck.title, ctx);
        break;
    }
    if (s.notes) slide.addNotes(s.notes);
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof Uint8Array) return Buffer.from(out);
  if (out instanceof ArrayBuffer) return Buffer.from(new Uint8Array(out));
  throw new Error("pptxgenjs n'a pas produit de tampon binaire.");
}
