import { describe, expect, it } from "vitest";
import { brandFromTheme, mapFont } from "@/domain/import/brand-from-theme";
import type { ExtractedTheme } from "@/domain/import/office-theme";
import { BrandSchema } from "@/domain/schemas";

const theme = (over: Partial<ExtractedTheme> = {}): ExtractedTheme => ({
  name: "Bleu Nuit",
  colors: {
    dk1: "#1A1A2E",
    lt1: "#FAFAFA",
    dk2: "#333344",
    lt2: "#EEEEEE",
    accent1: "#0F4C81",
    accent2: "#E94560",
    accent3: "#16C79A",
    accent4: "#999999",
    accent5: "#FF0000",
    accent6: "#AAAAAA",
  },
  fonts: { major: "Georgia", minor: "Lato" },
  logoDataUrl: null,
  notes: [],
  ...over,
});

describe("brandFromTheme — couleurs", () => {
  it("devrait associer accent1/2/3, lt1 et dk1 aux rôles de la charte", () => {
    const { brand, notes } = brandFromTheme(theme());
    expect(brand.colors).toEqual({
      primary: "#0F4C81",
      secondary: "#E94560",
      accent: "#16C79A",
      background: "#FAFAFA",
      text: "#1A1A2E",
    });
    expect(brand.name).toBe("Bleu Nuit");
    expect(BrandSchema.safeParse(brand).success).toBe(true);
    expect(notes).toEqual([]);
  });

  it("devrait prendre l'accent restant le plus saturé quand accent3 manque", () => {
    const t = theme();
    delete t.colors.accent3;
    expect(brandFromTheme(t).brand.colors.accent).toBe("#FF0000");
  });

  it("devrait corriger un contraste texte/fond insuffisant et le dire", () => {
    const { brand, notes } = brandFromTheme(theme({ colors: { ...theme().colors, dk1: "#BBBBBB", dk2: "#CCCCCC", lt1: "#FFFFFF" } }));
    expect(contrast(brand.colors.text, brand.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(notes.join(" ")).toMatch(/[Cc]ontraste/);
  });

  it("devrait compléter les couleurs manquantes et le dire", () => {
    const { brand, notes } = brandFromTheme(theme({ colors: { accent1: "#0F4C81" } }));
    expect(BrandSchema.safeParse(brand).success).toBe(true);
    expect(brand.colors.primary).toBe("#0F4C81");
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("brandFromTheme — polices et nom", () => {
  it("devrait garder une police sûre (insensible à la casse) et remplacer les autres en le disant", () => {
    const { brand, notes } = brandFromTheme(theme({ fonts: { major: "georgia", minor: "Aptos" } }));
    expect(brand.fonts).toEqual({ heading: "Georgia", body: "Arial" });
    expect(notes).toContain("Police Aptos remplacée par Arial");
  });

  it("devrait utiliser le nom du thème, borné, ou un nom par défaut", () => {
    expect(brandFromTheme(theme({ name: "x".repeat(200) })).brand.name).toHaveLength(80);
    expect(brandFromTheme(theme({ name: null })).brand.name).toBe("Charte importée");
  });

  it("devrait reprendre le logo", () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    expect(brandFromTheme(theme({ logoDataUrl: logo })).brand.logoDataUrl).toBe(logo);
  });

  it("devrait reprendre les remarques de l'extraction", () => {
    expect(brandFromTheme(theme({ notes: ["Logo ignoré : plus de 500 Ko."] })).notes).toContain("Logo ignoré : plus de 500 Ko.");
  });
});

describe("mapFont", () => {
  it.each([
    ["Calibri", "Calibri", false],
    ["CALIBRI", "Calibri", false],
    ["Calibri Light", "Calibri", true],
    ["Open Sans SemiBold", "Open Sans", true],
    ["Garamond", "Georgia", true],
    ["Cambria", "Georgia", true],
    ["Source Serif Pro", "Georgia", true],
    ["Aptos Display", "Arial", true],
    ["Helvetica Neue", "Arial", true],
  ])("%s → %s", (input, expected, replaced) => {
    expect(mapFont(input, "Arial")).toEqual({ font: expected, replaced });
  });

  it("devrait utiliser le repli quand la police est absente", () => {
    expect(mapFont(null, "Calibri")).toEqual({ font: "Calibri", replaced: true });
  });
});

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
