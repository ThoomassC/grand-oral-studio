import { readFileSync } from "node:fs";
import path from "node:path";
import {
  checkBrand,
  compositeOver,
  contrastRatio,
  oklchHueDistance,
  parseCustomProperties,
  ruleBodies,
  stripComments,
  withAlpha,
} from "@thomascaron/opale-ui/contract";
import { describe, expect, it } from "vitest";

type Theme = "light" | "dark";
const TOKENS = ["paper", "card", "sunken", "ink", "graphite", "rule", "rule-hover", "on-rule", "margin", "line", "highlighter"] as const;
type FicheToken = (typeof TOKENS)[number];
type FichePalette = Record<FicheToken, string>;

const HEX = /^#[0-9a-f]{6}$/i;
const LIGHT_SELECTOR = ":root";
const DARK_SELECTOR = ':root[data-theme="dark"]';

/** Encre de danger d'Opale « sur surface » en clair (= `--opale-danger`, non surchargée ici). */
const OPALE_DANGER_LIGHT = "#b3261e";
/** Écart de teinte OKLCH minimal entre la marge et le rouge d'erreur : la marge ne doit pas se lire « erreur ». */
const MIN_HUE_DISTANCE_FROM_DANGER = 20;

const css = stripComments(readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8"));

/** Les propriétés personnalisées de tous les blocs du sélecteur, dans l'ordre du fichier. */
function declarations(selector: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const body of ruleBodies(css, selector)) {
    for (const [name, value] of parseCustomProperties(body)) merged.set(name, value);
  }
  return merged;
}

/**
 * Lit les --fiche-* littéraux (#RRGGBB) de globals.css : les blocs `:root {`
 * (clair), et les blocs `:root[data-theme="dark"] {` (ardoise, superposés au
 * clair). Échoue si un jeton manque ou n'est pas un hexadécimal opaque.
 */
function readPalette(theme: Theme): FichePalette {
  const tokens = declarations(LIGHT_SELECTOR);
  if (theme === "dark") {
    for (const [name, value] of declarations(DARK_SELECTOR)) tokens.set(name, value);
  }
  const palette = {} as FichePalette;
  for (const token of TOKENS) {
    const value = tokens.get(`--fiche-${token}`);
    if (value === undefined || !HEX.test(value)) {
      throw new Error(`--fiche-${token} (${theme}) : hexadécimal #RRGGBB attendu, lu « ${value ?? "absent"} »`);
    }
    palette[token] = value;
  }
  return palette;
}

/**
 * Le jeton --opale-* du bloc hors couche, qui doit pointer sur un --fiche-*
 * (`var(--fiche-…)`) : renvoie la valeur de ce --fiche-* dans le thème.
 */
function opaleFromFiche(name: string, theme: Theme): string {
  const value = declarations(LIGHT_SELECTOR).get(name);
  const match = value?.match(/^var\(--fiche-([a-z-]+)\)$/);
  const token = match?.[1] as FicheToken | undefined;
  if (token === undefined || !TOKENS.includes(token)) {
    throw new Error(`${name} : var(--fiche-…) attendu, lu « ${value ?? "absent"} »`);
  }
  return readPalette(theme)[token];
}

const TEXT_PAIRS: ReadonlyArray<readonly [FicheToken, FicheToken]> = [
  ["ink", "paper"],
  ["ink", "card"],
  ["ink", "sunken"],
  ["graphite", "paper"],
  ["graphite", "card"],
  ["graphite", "sunken"],
  ["rule", "paper"],
  ["rule", "card"],
  ["on-rule", "rule"],
  ["on-rule", "rule-hover"],
];

describe.each(["light", "dark"] as const)("palette « fiche bristol » — thème %s", (theme) => {
  it("devrait déclarer les dix jetons --fiche-* en hexadécimal opaque", () => {
    expect(() => readPalette(theme)).not.toThrow();
  });

  it.each(TEXT_PAIRS)("devrait tenir 4,5:1 pour %s sur %s (texte)", (foreground, background) => {
    const palette = readPalette(theme);
    expect(contrastRatio(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
  });

  it("devrait tenir 3:1 pour la marge sur la carte (élément graphique)", () => {
    const palette = readPalette(theme);
    expect(contrastRatio(palette.margin, palette.card)).toBeGreaterThanOrEqual(3);
  });

  it("devrait garder la marge à l'écart du rouge d'erreur d'Opale (teinte)", () => {
    const danger = theme === "light" ? OPALE_DANGER_LIGHT : (declarations(DARK_SELECTOR).get("--opale-danger-on-surface") ?? "");
    expect(oklchHueDistance(readPalette(theme).margin, danger)).toBeGreaterThanOrEqual(MIN_HUE_DISTANCE_FROM_DANGER);
  });

  it("devrait brancher le secondaire d'Opale sur la réglure (encre sur fond ≥ 4,5:1)", () => {
    const palette = readPalette(theme);
    expect(opaleFromFiche("--opale-secondary", theme)).toBe(palette.rule);
    expect(contrastRatio(opaleFromFiche("--opale-on-secondary", theme), opaleFromFiche("--opale-secondary-dark", theme))).toBeGreaterThanOrEqual(4.5);
  });

  it("devrait brancher l'accent d'Opale sur la réglure (bouton, badge, graphisme, surlignage)", () => {
    const palette = readPalette(theme);
    const accent = opaleFromFiche("--opale-accent", theme);
    expect(accent).toBe(palette.rule);
    // Bouton accent : encre sur l'accent.
    expect(contrastRatio(opaleFromFiche("--opale-on-accent", theme), accent)).toBeGreaterThanOrEqual(4.5);
    // Badge accent d'Opale : encre de l'accent sur 34 % d'accent posé sur la carte.
    const badge = compositeOver(withAlpha(accent, 0.34), palette.card);
    expect(contrastRatio(opaleFromFiche("--opale-accent-ink", theme), badge)).toBeGreaterThanOrEqual(4.5);
    // Étoiles, soleil : élément graphique sur la carte.
    expect(contrastRatio(opaleFromFiche("--opale-accent-graphic", theme), palette.card)).toBeGreaterThanOrEqual(3);
    // `bg-highlight-soft` (surligneur jaune) sous le texte « À compléter », en encre.
    expect(contrastRatio(palette.ink, palette.highlighter)).toBeGreaterThanOrEqual(4.5);
    expect(opaleFromFiche("--opale-accent-dark", theme)).toBe(palette["rule-hover"]);
  });

  it("devrait passer le contrat de marque d'Opale (primaire, focus, encre sur primaire)", () => {
    const palette = readPalette(theme);
    const report = checkBrand(
      { primary: palette.rule, primaryOnSurface: palette.rule, focus: palette.rule, onPrimary: palette["on-rule"] },
      { theme, reference: { text: palette.ink, surface: palette.card, background: palette.paper } },
    );
    expect(report.failures).toEqual([]);
  });
});

describe("palette « fiche bristol » — surcharge du danger en ardoise", () => {
  it("devrait tenir 4,5:1 pour --opale-danger-on-surface sur la carte sombre", () => {
    const danger = declarations(DARK_SELECTOR).get("--opale-danger-on-surface");
    expect(danger, "--opale-danger-on-surface absent du bloc sombre").toMatch(HEX);
    expect(contrastRatio(danger ?? "", readPalette("dark").card)).toBeGreaterThanOrEqual(4.5);
  });
});
