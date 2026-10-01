/**
 * Polices proposées pour la charte : présentes dans PowerPoint (Windows/macOS)
 * ou disponibles dans la bibliothèque de Canva, pour que l'export .pptx et
 * l'import Canva conservent la typographie.
 */
export const SAFE_FONTS = [
  { name: "Arial", kind: "sans" },
  { name: "Calibri", kind: "sans" },
  { name: "Montserrat", kind: "sans" },
  { name: "Open Sans", kind: "sans" },
  { name: "Roboto", kind: "sans" },
  { name: "Lato", kind: "sans" },
  { name: "Poppins", kind: "sans" },
  { name: "Verdana", kind: "sans" },
  { name: "Trebuchet MS", kind: "sans" },
  { name: "Georgia", kind: "serif" },
  { name: "Times New Roman", kind: "serif" },
] as const;

const SERIF = new Set<string>(SAFE_FONTS.filter((f) => f.kind === "serif").map((f) => f.name));

/** Pile CSS pour une police de charte, avec repli générique adapté. */
export function fontStack(font: string): string {
  const safe = font.replace(/["\\]/g, "");
  return `"${safe}", ${SERIF.has(safe) ? "Georgia, serif" : "Arial, Helvetica, sans-serif"}`;
}
