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
