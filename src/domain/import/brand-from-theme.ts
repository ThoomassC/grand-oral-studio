import { defaultBrand } from "../defaults";
import { SAFE_FONTS, type SafeFont } from "../fonts";
import { BrandSchema, type Brand } from "../schemas";
import type { ExtractedTheme, ThemeColorSlot } from "./office-theme";
import { saturation } from "./office-usage";

/**
 * Charte déduite d'un thème Office (fonction pure) :
 *   primary = accent1, secondary = accent2, accent = accent3 (sinon l'accent
 *   restant le plus saturé), background = lt1, text = dk1.
 * Thème Office PAR DÉFAUT et diapositives aux couleurs posées en dur (fichier
 * produit par un générateur) : l'usage réel prime —
 *   background = fond dominant, text = texte courant dominant,
 *   primary = couleur des titres, accent = couleur chromatique la plus
 *   fréquente, secondary = autre couleur chromatique, sinon autre couleur de
 *   texte, lisible sur le fond (≥ 4,5:1) dans les deux cas.
 * Sans couleur explicite, le thème est gardé et une remarque le signale.
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

const OFFICE_THEME_NAMES = /^(office|office theme|thème office|tema de office|office-design)$/i;

interface ColorRoles {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

/** Rôles tirés du thème (accent1/2/3, lt1, dk1), complétés par défaut au besoin. */
function rolesFromTheme(theme: ExtractedTheme, missing: string[]): ColorRoles {
  const fallback = defaultBrand();
  const c = theme.colors;
  const pick = (slot: ThemeColorSlot, role: string, def: string): string => {
    const value = c[slot];
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
  const text = pick("dk1", "de texte", fallback.colors.text);
  return { primary, secondary, accent, background, text };
}

/** Rôles tirés de l'usage réel des diapositives ; ce qui manque reste celui du thème. */
function rolesFromUsage(usage: NonNullable<ExtractedTheme["usage"]>, base: ColorRoles, notes: string[]): ColorRoles {
  const background = usage.background ?? base.background;
  const text = usage.text ?? usage.title ?? base.text;
  const accent = usage.accents[0];
  if (!accent) notes.push("Aucune couleur d'accent dans les diapositives : celle du thème Office par défaut est gardée, vérifiez-la.");
  // Des titres de la couleur du fond (texte clair sur bandeaux) ne font pas une couleur principale.
  const title = usage.title && usage.title !== background ? usage.title : null;
  const primary = title ?? accent ?? base.primary;
  // La secondaire colore les sous-titres sur le fond : elle doit y rester lisible.
  const used = new Set([background, text, primary, accent]);
  const readable = (c: string) => !used.has(c) && contrastRatio(c, background) >= MIN_TEXT_CONTRAST;
  const secondary = usage.accents.find(readable) ?? usage.textColors.find(readable) ?? text;
  return { primary, secondary, accent: accent ?? base.accent, background, text };
}

export function brandFromTheme(theme: ExtractedTheme): { brand: Brand; notes: string[] } {
  const notes = [...theme.notes];
  const usage = theme.usage ?? null;
  const officeColors = theme.officeDefault?.colors === true;
  const officeFonts = theme.officeDefault?.fonts === true;
  const useColors = officeColors && usage?.explicitColors === true;
  const useFonts = officeFonts && usage?.explicitFonts === true;

  const missing: string[] = [];
  const fromTheme = rolesFromTheme(theme, missing);
  let roles = fromTheme;
  if (usage && useColors) {
    roles = rolesFromUsage(usage, fromTheme, notes);
  } else if (missing.length > 0) {
    notes.push(`Couleurs absentes du thème, complétées par défaut : ${missing.join(", ")}.`);
  }
  if (useColors || useFonts) {
    const what = useColors && useFonts ? "couleurs et polices lues" : useColors ? "couleurs lues" : "polices lues";
    notes.push(`Le fichier garde le thème Office par défaut : ${what} dans les diapositives.`);
  }
  if (officeColors && !useColors) notes.push("Le fichier n'utilise que le thème Office par défaut : vérifiez les couleurs.");
  if (officeFonts && !useFonts) notes.push("Polices du thème Office par défaut : vérifiez les polices.");

  const { primary, secondary, accent, background } = roles;
  let { text } = roles;
  const initial = contrastRatio(text, background);
  if (initial < MIN_TEXT_CONTRAST) {
    const candidates = [theme.colors.dk2, "#000000", "#FFFFFF"].filter((v): v is string => v !== undefined);
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
  const headingName = useFonts ? (usage?.headingFont ?? usage?.bodyFont ?? theme.fonts.major) : theme.fonts.major;
  const bodyName = useFonts ? (usage?.bodyFont ?? usage?.headingFont ?? theme.fonts.minor) : theme.fonts.minor;
  const heading = fontFor(headingName ?? null);
  const body = fontFor(bodyName ?? null);

  // Le nom générique du thème Office n'est pas celui de la charte.
  const themeName = theme.name?.trim();
  const name = themeName && !(officeColors && OFFICE_THEME_NAMES.test(themeName)) ? themeName : DEFAULT_NAME;

  const brand = BrandSchema.parse({
    name: name.slice(0, 80),
    colors: { primary, secondary, accent, background, text },
    fonts: { heading, body },
    logoDataUrl: theme.logoDataUrl,
  });
  // Une police remplacée deux fois (titres et texte) n'est signalée qu'une fois.
  return { brand, notes: [...new Set(notes)] };
}
