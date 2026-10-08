/**
 * Polices autorisées dans une charte : présentes dans PowerPoint (Windows/macOS)
 * ou dans la bibliothèque de Canva, pour que l'export .pptx et l'import Canva
 * conservent la typographie. Liste fermée : elle sert aussi de défense, aucun
 * nom de police arbitraire n'atteint le XML de l'export.
 */
export const SAFE_FONTS = [
  "Arial",
  "Calibri",
  "Montserrat",
  "Open Sans",
  "Roboto",
  "Lato",
  "Poppins",
  "Verdana",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
] as const;

export type SafeFont = (typeof SAFE_FONTS)[number];

export const SERIF_FONTS: ReadonlySet<SafeFont> = new Set<SafeFont>(["Georgia", "Times New Roman"]);

export function isSafeFont(value: string): value is SafeFont {
  return (SAFE_FONTS as readonly string[]).includes(value);
}

/**
 * Polices présentes sur tout ordinateur qui ouvre le .pptx dans PowerPoint :
 * livrées avec Windows et macOS, ou installées avec Office (Calibri). Les
 * autres (Montserrat, Open Sans…) viennent de Canva ou de Google Fonts : le
 * fichier exporté ne les embarque pas.
 */
export const SYSTEM_FONTS: ReadonlySet<SafeFont> = new Set<SafeFont>([
  "Arial",
  "Calibri",
  "Verdana",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
]);

export const FONT_NOT_EMBEDDED_WARNING =
  "Cette police n'est pas incluse dans le fichier PowerPoint : sur un ordinateur qui ne l'a pas, elle sera remplacée et le texte peut déborder.";

/** Avertissement à afficher sous le choix d'une police, ou null si elle est sûre partout. */
export function fontWarning(fontName: string): string | null {
  return isSafeFont(fontName) && SYSTEM_FONTS.has(fontName) ? null : FONT_NOT_EMBEDDED_WARNING;
}
