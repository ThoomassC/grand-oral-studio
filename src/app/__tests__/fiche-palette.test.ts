import { readFileSync } from "node:fs";
import path from "node:path";
import { checkBrand, contrastRatio, parseCustomProperties, ruleBodies, stripComments } from "@thomascaron/opale-ui/contract";
import { describe, expect, it } from "vitest";

type Theme = "light" | "dark";
const TOKENS = ["paper", "card", "sunken", "ink", "graphite", "rule", "rule-hover", "on-rule", "margin", "line"] as const;
type FicheToken = (typeof TOKENS)[number];
type FichePalette = Record<FicheToken, string>;

const HEX = /^#[0-9a-f]{6}$/i;
const LIGHT_SELECTOR = ":root";
const DARK_SELECTOR = ':root[data-theme="dark"]';

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
