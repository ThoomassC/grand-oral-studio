import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import { parseThemeImport } from "@/server/theme-import";
import { parseInput, ThemeImportTextSchema } from "@/server/validation";

// Valeurs du contrat, écrites en dur : un test qui relit la constante suivrait sa dérive.
const THEME_IMPORT_MAX_LINES = 30;
const THEME_IMPORT_MAX_BYTES = 20 * 1024;

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `Thème ${i + 1}`).join("\n");
}

describe("parseThemeImport — format Nom | description | mots, clés", () => {
  it("devrait lire nom, description et mots-clés", () => {
    expect(parseThemeImport("Numérique | Réseaux et données | internet, données")).toEqual({
      ok: true,
      themes: [{ name: "Numérique", description: "Réseaux et données", keywords: ["internet", "données"] }],
    });
  });

  it("devrait accepter une ligne réduite au nom", () => {
    expect(parseThemeImport("Ville")).toEqual({ ok: true, themes: [{ name: "Ville", description: "", keywords: [] }] });
  });

  it("devrait accepter une description vide suivie de mots-clés", () => {
    expect(parseThemeImport("Ville | | urbanisme ; mobilité")).toEqual({
      ok: true,
      themes: [{ name: "Ville", description: "", keywords: ["urbanisme", "mobilité"] }],
    });
  });

  it("devrait dédoublonner les mots-clés à la casse et aux accents près", () => {
    const result = parseThemeImport("Énergie | | Climat, climat, CLIMAT, énergie, energie");
    expect(result.ok && result.themes[0]?.keywords).toEqual(["Climat", "énergie"]);
  });

  it("devrait ignorer lignes vides et commentaires, et accepter les fins de ligne Windows", () => {
    const result = parseThemeImport("# en-tête\r\n\r\nUn\r\n   \r\n# autre\r\nDeux");
    expect(result.ok && result.themes.map((t) => t.name)).toEqual(["Un", "Deux"]);
  });
});

describe("parseThemeImport — lignes invalides", () => {
  it("devrait signaler un nom trop court avec son numéro de ligne", () => {
    const result = parseThemeImport("Valide\nX | trop court");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((e) => e.line)).toEqual([2]);
  });

  it("devrait signaler une ligne avec plus de trois colonnes", () => {
    const result = parseThemeImport("Un | a | b | c");
    expect(!result.ok && result.errors).toEqual([{ line: 1, message: expect.stringContaining("|") }]);
  });

  it("devrait signaler un nom vide", () => {
    const result = parseThemeImport("| description seule");
    expect(!result.ok && result.errors.map((e) => e.line)).toEqual([1]);
  });

  it("devrait signaler un doublon de nom dans l'import en citant la première ligne", () => {
    const result = parseThemeImport("Énergie\n\nenergie");
    expect(!result.ok && result.errors).toEqual([{ line: 3, message: expect.stringContaining("ligne 1") }]);
  });

  it("devrait rejeter tout l'import quand une seule ligne est invalide", () => {
    expect(parseThemeImport("Un\nDeux\nX").ok).toBe(false);
  });

  it.each([
    { cas: "un texte vide", text: "" },
    { cas: "uniquement des commentaires", text: "# rien\n\n# toujours rien" },
  ])("devrait signaler l'absence de thème pour $cas", ({ text }) => {
    const result = parseThemeImport(text);
    expect(!result.ok && result.errors).toEqual([{ line: 0, message: expect.stringMatching(/aucun thème/i) }]);
  });
});

describe("parseThemeImport — limite de lignes", () => {
  it(`devrait accepter exactement ${THEME_IMPORT_MAX_LINES} thèmes`, () => {
    const result = parseThemeImport(lines(THEME_IMPORT_MAX_LINES));
    expect(result.ok && result.themes).toHaveLength(THEME_IMPORT_MAX_LINES);
  });

  it(`devrait refuser ${THEME_IMPORT_MAX_LINES + 1} thèmes avec une erreur globale unique`, () => {
    const result = parseThemeImport(lines(THEME_IMPORT_MAX_LINES + 1));
    expect(!result.ok && result.errors).toEqual([{ line: 0, message: expect.stringContaining(String(THEME_IMPORT_MAX_LINES)) }]);
  });

  it("ne devrait pas compter commentaires et lignes vides dans la limite", () => {
    const text = `# commentaire\n\n${lines(THEME_IMPORT_MAX_LINES)}\n\n# fin`;
    expect(parseThemeImport(text).ok).toBe(true);
  });
});

describe("ThemeImportTextSchema — limite de 20 Ko", () => {
  it("devrait accepter un texte d'exactement 20 Ko", () => {
    const text = "a".repeat(THEME_IMPORT_MAX_BYTES);
    expect(parseInput(ThemeImportTextSchema, text)).toBe(text);
  });

  it("devrait lever ValidationError pour un octet de trop", () => {
    expect(() => parseInput(ThemeImportTextSchema, "a".repeat(THEME_IMPORT_MAX_BYTES + 1))).toThrow(ValidationError);
  });

  it("devrait compter en octets UTF-8 et non en caractères", () => {
    // « é » = 2 octets : la moitié de la limite en caractères dépasse déjà d'un octet.
    const text = "é".repeat(THEME_IMPORT_MAX_BYTES / 2) + "a";
    expect(text.length).toBeLessThan(THEME_IMPORT_MAX_BYTES);
    expect(() => parseInput(ThemeImportTextSchema, text)).toThrow(ValidationError);
  });
});
