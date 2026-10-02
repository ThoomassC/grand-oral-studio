import { defaultBrand } from "../defaults";
import { SAFE_FONTS, type SafeFont } from "../fonts";
import { BrandSchema, type Brand } from "../schemas";
import type { ExtractedTheme, ThemeColorSlot } from "./office-theme";

/**
 * Charte déduite d'un thème Office (fonction pure) :
 *   primary = accent1, secondary = accent2, accent = accent3 (sinon l'accent
 *   restant le plus saturé), background = lt1, text = dk1.
 * Contraste texte/fond garanti ≥ 4,5:1 (WCAG AA), corrigé et signalé au besoin.
 * Polices ramenées à la liste SAFE_FONTS, avec une remarque pour chaque remplacement.
 */

export const MIN_TEXT_CONTRAST = 4.5;
const DEFAULT_NAME = "Charte importée";

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
}

function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = channel(hex, i);
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Saturation HSL (0..1). */
function saturation(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => channel(hex, i)) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function ratioText(ratio: number): string {
  return `${ratio.toFixed(1).replace(".", ",")}:1`;
}

const SERIF_HINTS = [
  "serif",
  "garamond",
  "cambria",
  "times",
  "palatino",
  "book antiqua",
  "baskerville",
  "bodoni",
  "didot",
  "constantia",
  "century",
  "merriweather",
  "playfair",
  "lora",
  "caslon",
  "minion",
  "charter",
  "cochin",
  "hoefler",
  "georgia",
];

/**
 * Police sûre la plus proche : correspondance exacte (insensible à la casse),
 * sinon même famille (« Open Sans SemiBold » → Open Sans), sinon Georgia pour
 * une police à empattements, sinon `fallback`.
 */
export function mapFont(name: string | null, fallback: SafeFont): { font: SafeFont; replaced: boolean } {
  const n = name?.trim().toLowerCase();
  if (!n) return { font: fallback, replaced: true };
  const exact = SAFE_FONTS.find((f) => f.toLowerCase() === n);
  if (exact) return { font: exact, replaced: false };
  const family = [...SAFE_FONTS].sort((a, b) => b.length - a.length).find((f) => n.startsWith(`${f.toLowerCase()} `));
  if (family) return { font: family, replaced: true };
  const serif = SERIF_HINTS.some((h) => n.includes(h)) && !/\bsans\b/.test(n);
  return { font: serif ? "Georgia" : fallback, replaced: true };
}

export function brandFromTheme(theme: ExtractedTheme): { brand: Brand; notes: string[] } {
  const notes = [...theme.notes];
  const fallback = defaultBrand();
  const c = theme.colors;
  const missing: string[] = [];
  const pick = (slot: ThemeColorSlot | undefined, role: string, def: string): string => {
    const value = slot ? c[slot] : undefined;
    if (value) return value;
    missing.push(role);
    return def;
  };

  const primary = pick("accent1", "principale", fallback.colors.primary);
  const secondary = pick("accent2", "secondaire", fallback.colors.secondary);
  let accent = c.accent3;
  if (!accent) {
    const used = new Set([c.accent1, c.accent2]);
    const rest = (["accent4", "accent5", "accent6"] as const)
      .map((s) => c[s])
      .filter((v): v is string => v !== undefined && !used.has(v))
      .sort((a, b) => saturation(b) - saturation(a));
    accent = rest[0];
  }
  if (!accent) {
    missing.push("d'accent");
    accent = fallback.colors.accent;
  }
  const background = pick("lt1", "de fond", fallback.colors.background);
  let text = pick("dk1", "de texte", fallback.colors.text);
  if (missing.length > 0) notes.push(`Couleurs absentes du thème, complétées par défaut : ${missing.join(", ")}.`);

  const initial = contrastRatio(text, background);
  if (initial < MIN_TEXT_CONTRAST) {
    const candidates = [c.dk2, "#000000", "#FFFFFF"].filter((v): v is string => v !== undefined);
    const passing = candidates.find((v) => contrastRatio(v, background) >= MIN_TEXT_CONTRAST);
    const best = passing ?? candidates.sort((a, b) => contrastRatio(b, background) - contrastRatio(a, background))[0] ?? "#000000";
    notes.push(
      `Contraste texte/fond insuffisant (${ratioText(initial)}) : texte remplacé par ${best} (${ratioText(contrastRatio(best, background))}).`,
    );
    text = best;
  }

  const fontFor = (name: string | null): SafeFont => {
    const { font, replaced } = mapFont(name, "Arial");
    if (replaced) notes.push(name ? `Police ${name} remplacée par ${font}` : `Police absente du thème : ${font} utilisée`);
    return font;
  };
  const heading = fontFor(theme.fonts.major);
  const body = fontFor(theme.fonts.minor);

  const brand = BrandSchema.parse({
    name: (theme.name?.trim() || DEFAULT_NAME).slice(0, 80),
    colors: { primary, secondary, accent, background, text },
    fonts: { heading, body },
    logoDataUrl: theme.logoDataUrl,
  });
  // Une police remplacée deux fois (titres et texte) n'est signalée qu'une fois.
  return { brand, notes: [...new Set(notes)] };
}
