import type { CSSProperties, ReactNode } from "react";
import { isSafeFont, type SafeFont } from "@/domain/fonts";
import type { Brand, PromptTemplate, SlideLayout } from "@/domain/schemas";
import {
  BODY_LINE_SPACING,
  BULLET_INDENT_RATIO,
  bulletFontSizePt,
  LOGO_BOX_IN,
  PARA_SPACE_RATIO,
  SLIDE_MARGIN_IN,
  SLIDE_WIDTH_IN,
  slideGeometry,
  slideHeightIn,
  splitColumns,
  TEXT_INSET_PT,
  TITLE_LINE_SPACING,
  titleFontSizePt,
  type Box,
} from "@/domain/typography";
import { fontStack } from "./fonts";

export interface SlidePreviewData {
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
}

export type SlideBrand = Pick<Brand, "colors" | "fonts" | "logoDataUrl">;

interface SlidePreviewProps {
  slide: SlidePreviewData;
  brand: SlideBrand;
  format: PromptTemplate["format"];
  /** Numéro affiché en bas à droite (1-based), absent sur la couverture. */
  number?: number;
  /** Titre du deck, rappelé en pied de page comme dans le .pptx. */
  deckTitle?: string;
  /** Tronque les textes (petites miniatures uniquement, ex. grille des squelettes). */
  clamp?: boolean;
  /**
   * Masque l'aperçu aux technologies d'assistance quand le même texte est déjà
   * présent ailleurs dans la page (évite la double lecture).
   */
  decorative?: boolean;
  className?: string;
}

/*
 * Miroir du rendu .pptx (src/export/pptx.ts, qui fait foi) : mêmes zones
 * (slideGeometry) et mêmes tailles (titleFontSizePt / bulletFontSizePt) que
 * l'export. La diapo mesure 10 pouces de large = 100cqw : 1 pouce = 10cqw et
 * 1 pt = 10/72 cqw ≈ 0,139cqw. Composant pur, utilisable côté serveur et client.
 */
const inch = (v: number) => `${(v * 10).toFixed(3)}cqw`;
const pt = (v: number) => `${((v * 10) / 72).toFixed(3)}cqw`;
const safeFont = (value: string): SafeFont => (isSafeFont(value) ? value : "Arial");

type VAlign = "top" | "middle" | "bottom";
const JUSTIFY: Record<VAlign, string> = { top: "flex-start", middle: "center", bottom: "flex-end" };

function Area({ box, valign = "top", style, children }: { box: Box; valign?: VAlign; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div
      className="absolute flex flex-col overflow-hidden"
      style={{
        left: inch(box.x),
        top: inch(box.y),
        width: inch(box.w),
        height: inch(box.h),
        padding: pt(TEXT_INSET_PT),
        justifyContent: JUSTIFY[valign],
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function clampStyle(clamp: boolean, lines: number): CSSProperties {
  return clamp ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" } : {};
}

function BulletList({
  items,
  size,
  color,
  font,
  marker,
  clamp,
}: {
  items: string[];
  size: number;
  color: string;
  font: string;
  marker?: string;
  clamp: boolean;
}) {
  return (
    <ul style={{ fontSize: pt(size), lineHeight: BODY_LINE_SPACING, color, fontFamily: fontStack(font) }}>
      {items.map((b, i) => (
        <li key={i} className="flex" style={{ marginBottom: i < items.length - 1 ? pt(size * PARA_SPACE_RATIO) : 0 }}>
          <span aria-hidden="true" className="shrink-0" style={{ width: pt(size * BULLET_INDENT_RATIO) }}>
            {marker ?? "•"}
          </span>
          <span className="min-w-0" style={clampStyle(clamp, 2)}>
            {b}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Rect({ box, color }: { box: Box; color: string }) {
  return (
    <div
      className="absolute"
      style={{ left: inch(box.x), top: inch(box.y), width: inch(box.w), height: inch(box.h), background: color }}
    />
  );
}

export function SlidePreview({
  slide,
  brand,
  format,
  number,
  deckTitle,
  clamp = false,
  decorative = false,
  className = "",
}: SlidePreviewProps) {
  const { colors, fonts, logoDataUrl } = brand;
  const W = SLIDE_WIDTH_IN;
  const H = slideHeightIn(format);
  const { layout } = slide;
  const subtitle = slide.subtitle ?? "";
  const bullets = slide.bullets ?? [];
  const hasSubtitle = subtitle.length > 0;
  const headingFont = safeFont(fonts.heading);
  const bodyFont = safeFont(fonts.body);
  const geo = slideGeometry(layout, format, hasSubtitle, bullets);
  const titleSize = titleFontSizePt(slide.title, layout, format, { font: headingFont, bullets });
  const bulletSize = bulletFontSizePt(bullets, layout, format, hasSubtitle, { font: bodyFont });
  const filledCover = layout === "title";
  const onDarkLogo = layout === "title" || layout === "conclusion";

  const titleColor = layout === "title" || layout === "conclusion" ? colors.background : colors.primary;
  const titleAlign: VAlign =
    layout === "title" ? "bottom" : layout === "section" ? (geo.hero ? "bottom" : "middle") : "middle";
  const subtitleColor = layout === "title" ? colors.background : colors.secondary;
  const subtitleSize = layout === "title" ? 20 : layout === "section" && geo.hero ? 20 : 16;

  const lineClamp = (n: number): CSSProperties => clampStyle(clamp, n);

  const decorations: ReactNode[] = [];
  if (layout === "title") decorations.push(<Rect key="band" box={{ x: 0, y: H - 0.35, w: W, h: 0.35 }} color={colors.accent} />);
  if (layout === "section") decorations.push(<Rect key="bar" box={{ x: 0, y: 0, w: 0.35, h: H }} color={colors.primary} />);
  if (layout === "conclusion") decorations.push(<Rect key="band" box={{ x: 0, y: 0, w: W, h: 1.5 }} color={colors.primary} />);
  if (layout === "content" || layout === "two-columns")
    decorations.push(<Rect key="accent" box={{ x: SLIDE_MARGIN_IN, y: 1.35, w: 1.2, h: 0.06 }} color={colors.accent} />);

  const [left, right] = layout === "two-columns" ? splitColumns(bullets) : [bullets, []];
  const marker = layout === "conclusion" ? "✓" : undefined;
  const listProps = { size: bulletSize, color: colors.text, font: fonts.body, clamp };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border border-border ${className}`}
      style={{
        aspectRatio: format === "4:3" ? "4 / 3" : "16 / 9",
        containerType: "inline-size",
        background: filledCover ? colors.primary : colors.background,
        color: colors.text,
        fontFamily: fontStack(fonts.body),
      }}
      aria-hidden={decorative || undefined}
    >
      {decorations}

      <Area box={geo.title} valign={titleAlign}>
        <p
          style={{
            fontFamily: fontStack(fonts.heading),
            fontWeight: 700,
            fontSize: pt(titleSize),
            lineHeight: TITLE_LINE_SPACING,
            color: titleColor,
            ...lineClamp(3),
          }}
        >
          {slide.title}
        </p>
      </Area>

      {geo.subtitle && hasSubtitle ? (
        <Area box={geo.subtitle}>
          <p style={{ fontSize: pt(subtitleSize), fontStyle: "italic", color: subtitleColor, lineHeight: 1.2, ...lineClamp(1) }}>
            {subtitle}
          </p>
        </Area>
      ) : null}

      {geo.body[0] && left.length > 0 ? (
        <Area box={geo.body[0]}>
          <BulletList items={left} marker={marker} {...listProps} />
        </Area>
      ) : null}
      {geo.body[1] && right.length > 0 ? (
        <>
          <Area box={geo.body[1]}>
            <BulletList items={right} {...listProps} />
          </Area>
          <Rect
            box={{
              x: (geo.body[0]!.x + geo.body[0]!.w + geo.body[1].x) / 2,
              y: geo.body[0]!.y + 0.1,
              w: 0.012,
              h: geo.body[0]!.h - 0.2,
            }}
            color={colors.secondary}
          />
        </>
      ) : null}

      {logoDataUrl ? (
        <div
          className="absolute"
          style={{
            right: inch(SLIDE_MARGIN_IN * 0.6 - (onDarkLogo ? 0.08 : 0)),
            top: inch(onDarkLogo ? 0.22 : 0.3),
            padding: onDarkLogo ? inch(0.08) : 0,
            background: onDarkLogo ? colors.background : "transparent",
            borderRadius: inch(0.08),
            lineHeight: 0,
          }}
        >
          {/* Data URL locale : next/image n'apporte rien ici. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoDataUrl}
            alt=""
            className="inline-block object-contain"
            style={{ maxWidth: inch(LOGO_BOX_IN.w), maxHeight: inch(LOGO_BOX_IN.h) }}
          />
        </div>
      ) : null}

      {layout !== "title" ? (
        <div
          className="absolute flex items-center justify-between gap-2"
          style={{
            left: inch(SLIDE_MARGIN_IN),
            right: inch(SLIDE_MARGIN_IN),
            top: inch(H - 0.36),
            height: inch(0.26),
            fontSize: pt(9),
            color: colors.secondary,
          }}
        >
          <span className="truncate">{deckTitle ?? ""}</span>
          {number !== undefined ? <span className="shrink-0 tabular-nums">{number}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
