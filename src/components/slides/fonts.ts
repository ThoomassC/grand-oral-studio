import { isSafeFont, SAFE_FONTS as DOMAIN_SAFE_FONTS, SERIF_FONTS } from "@/domain/fonts";

/**
 * Polices proposées pour la charte : la liste fait autorité côté serveur
 * (enum de BrandSchema), on la reprend telle quelle pour le sélecteur.
 */
export const SAFE_FONTS: readonly string[] = DOMAIN_SAFE_FONTS;

/** Pile CSS pour une police de charte, avec repli générique adapté. */
export function fontStack(font: string): string {
  const safe = font.replace(/["\\]/g, "");
  const serif = isSafeFont(safe) && SERIF_FONTS.has(safe);
  return `"${safe}", ${serif ? "Georgia, serif" : "Arial, Helvetica, sans-serif"}`;
}
