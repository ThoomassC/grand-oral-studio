import type { CSSProperties } from "react";
import type { Brand, PromptTemplate, SlideLayout } from "@/domain/schemas";
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
  /** Numéro affiché en bas à droite (1-based). */
  number?: number;
  /** Nombre maximal de puces affichées (les miniatures restent lisibles). */
  maxBullets?: number;
  /**
   * Masque l'aperçu aux technologies d'assistance quand le même texte est déjà
   * présent ailleurs dans la page (évite la double lecture).
   */
  decorative?: boolean;
  className?: string;
}

/**
 * Miniature d'une diapositive rendue avec la charte du programme. Composant
 * pur (sans état ni effet) : utilisable dans un Server ou un Client Component.
 * Les tailles de texte suivent la largeur du conteneur (unités cqw), la
 * miniature garde donc ses proportions à toutes les tailles.
 */
export function SlidePreview({
  slide,
  brand,
  format,
  number,
  maxBullets = 5,
  decorative = false,
  className = "",
}: SlidePreviewProps) {
  const { colors, fonts, logoDataUrl } = brand;
  const isCover = slide.layout === "title";
  const isSection = slide.layout === "section";
  const isConclusion = slide.layout === "conclusion";
  const filled = isCover || isConclusion;

  const surface: CSSProperties = {
    aspectRatio: format === "4:3" ? "4 / 3" : "16 / 9",
    containerType: "inline-size",
    background: filled ? colors.primary : colors.background,
    color: filled ? colors.background : colors.text,
    fontFamily: fontStack(fonts.body),
  };
  const headingFont: CSSProperties = { fontFamily: fontStack(fonts.heading) };
  const bullets = (slide.bullets ?? []).slice(0, maxBullets);
  const hiddenBullets = (slide.bullets?.length ?? 0) - bullets.length;
  const twoColumns = slide.layout === "two-columns";

  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border border-border ${className}`}
      style={surface}
      aria-hidden={decorative || undefined}
    >
      {isSection ? (
        <div className="absolute inset-y-0 left-0" style={{ width: "3.5cqw", background: colors.accent }} />
      ) : null}
      {!filled && !isSection ? (
        <div className="absolute inset-x-0 top-0" style={{ height: "1.2cqw", background: colors.primary }} />
      ) : null}
      {filled ? (
        <div
          className="absolute bottom-0 left-0"
          style={{ height: "1.2cqw", width: "28cqw", background: colors.accent }}
        />
      ) : null}

      <div
        className="absolute inset-0 flex flex-col"
        style={{
          padding: isSection ? "6cqw 7cqw 6cqw 10cqw" : "6cqw 7cqw",
          justifyContent: isCover || isSection ? "center" : "flex-start",
          gap: "2cqw",
        }}
      >
        <p
          className="line-clamp-3 font-bold"
          style={{
            ...headingFont,
            fontSize: isCover ? "6.2cqw" : isSection ? "5.6cqw" : "4.4cqw",
            lineHeight: 1.15,
            color: filled ? colors.background : isSection ? colors.secondary : colors.primary,
          }}
        >
          {slide.title}
        </p>
        {slide.subtitle ? (
          <p
            className="line-clamp-2"
            style={{
              fontSize: isCover ? "3.2cqw" : "2.8cqw",
              lineHeight: 1.3,
              opacity: 0.9,
              color: filled ? colors.background : colors.secondary,
            }}
          >
            {slide.subtitle}
          </p>
        ) : null}
        {bullets.length > 0 && !isCover ? (
          <ul
            style={{
              fontSize: "2.7cqw",
              lineHeight: 1.35,
              display: "grid",
              gridTemplateColumns: twoColumns ? "1fr 1fr" : "1fr",
              columnGap: "4cqw",
              rowGap: "1.2cqw",
              marginTop: "1cqw",
            }}
          >
            {bullets.map((b, i) => (
              <li key={i} className="flex" style={{ gap: "1.5cqw" }}>
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-full"
                  style={{
                    width: "1.3cqw",
                    height: "1.3cqw",
                    marginTop: "1cqw",
                    background: filled ? colors.background : colors.accent,
                  }}
                />
                <span className="line-clamp-2">{b}</span>
              </li>
            ))}
            {hiddenBullets > 0 ? (
              <li style={{ opacity: 0.75, gridColumn: "1 / -1" }}>
                + {hiddenBullets} autre{hiddenBullets > 1 ? "s" : ""}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {logoDataUrl ? (
        // Data URL locale : next/image n'apporte rien ici (pas d'optimisation possible).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoDataUrl}
          alt=""
          className="absolute object-contain"
          style={{
            right: "3cqw",
            ...(isCover ? { top: "3cqw" } : { bottom: "3cqw" }),
            height: isCover ? "9cqw" : "6cqw",
            maxWidth: "22cqw",
          }}
        />
      ) : null}
      {number !== undefined ? (
        <span
          className="absolute tabular-nums"
          style={{ left: "3cqw", bottom: "2.4cqw", fontSize: "2.2cqw", opacity: 0.7 }}
        >
          {number}
        </span>
      ) : null}
    </div>
  );
}
