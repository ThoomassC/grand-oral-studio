import { describe, expect, it } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import { contrastRatio } from "@/domain/import/brand-from-theme";
import { parseThemePromptText } from "@/domain/import/themes-from-text";
import { BrandSchema, ThemeInputSchema, type Brand } from "@/domain/schemas";

const CURRENT: Brand = {
  name: "Ma charte",
  colors: { primary: "#112233", secondary: "#445566", accent: "#AA5500", background: "#FFFFFF", text: "#222222" },
  fonts: { heading: "Montserrat", body: "Lato" },
  logoDataUrl: null,
};

const names = (themes: { name: string }[]) => themes.map((t) => t.name);

describe("parseThemePromptText — thèmes", () => {
  it("devrait lire une liste numérotée sur plusieurs lignes", () => {
    const out = parseThemePromptText(
      "Mon oral porte sur l'économie.\nThèmes :\n1. Inflation : causes et effets\n2. Chômage\n3) Croissance verte",
      CURRENT,
    );
    expect(names(out.themes)).toEqual(["Inflation", "Chômage", "Croissance verte"]);
    expect(out.themes[0]?.description).toBe("causes et effets");
    // Le nombre de sujets se lit sur la liste : `brandFound` ne décrit que l'apparence.
    expect(out.brandFound).toEqual([]);
    expect(out.brand).toBeNull();
  });

  it("devrait lire une liste à puces", () => {
    const out = parseThemePromptText("- La photosynthèse\n- Le cycle de l'eau\n* Les volcans", CURRENT);
    expect(names(out.themes)).toEqual(["La photosynthèse", "Le cycle de l'eau", "Les volcans"]);
  });

  it("devrait lire une liste collée sur une seule ligne, sans couper la suite", () => {
    const out = parseThemePromptText(
      "Grand oral de SES. Thèmes : 1. Les inégalités 2. La mondialisation 3. L'école et la mobilité sociale. Couleurs : fond blanc.",
      CURRENT,
    );
    expect(names(out.themes)).toEqual(["Les inégalités", "La mondialisation", "L'école et la mobilité sociale"]);
    expect(out.brand?.colors.background).toBe("#FFFFFF");
  });

  it("devrait couper une liste en ligne avant une consigne de charte sans deux-points direct", () => {
    const out = parseThemePromptText(
      "Thèmes : 1. Inflation 2. Chômage 3. Croissance. Couleur principale : #1F3A5F. Police des titres : Georgia. Fond blanc.",
      CURRENT,
    );
    expect(names(out.themes)).toEqual(["Inflation", "Chômage", "Croissance"]);
    expect(out.brand?.colors.primary).toBe("#1F3A5F");
    expect(out.brand?.fonts.heading).toBe("Georgia");
    expect(out.brandFound).toContain("Couleur de fond : #FFFFFF");
  });

  it("devrait lire le format « Nom | description | mots-clés »", () => {
    const out = parseThemePromptText(
      "IA et emploi | Effets de l'automatisation | robots, travail; robots\nClimat | | GIEC",
      CURRENT,
    );
    expect(out.themes).toEqual([
      { name: "IA et emploi", description: "Effets de l'automatisation", keywords: ["robots", "travail"], notes: "" },
      { name: "Climat", description: "", keywords: ["GIEC"], notes: "" },
    ]);
  });

  it("devrait lire « Thème 1 : … »", () => {
    const out = parseThemePromptText("Thème 1 : La Révolution française\nThème 2 : L'Empire", CURRENT);
    expect(names(out.themes)).toEqual(["La Révolution française", "L'Empire"]);
  });

  it("devrait lire « Thèmes : a, b, c » et un en-tête suivi de lignes simples", () => {
    expect(names(parseThemePromptText("Mes thèmes : inflation, chômage ; croissance", CURRENT).themes)).toEqual([
      "inflation",
      "chômage",
      "croissance",
    ]);
    const out = parseThemePromptText("Thèmes :\nLa justice\nLa liberté\n\nCouleur principale : rouge", CURRENT);
    expect(names(out.themes)).toEqual(["La justice", "La liberté"]);
    expect(out.brand?.colors.primary).toBe("#C62828");
  });

  it("devrait dédoublonner sans tenir compte de la casse ni des accents", () => {
    const out = parseThemePromptText("1. Écologie\n2. ecologie\n3. Énergie", CURRENT);
    expect(names(out.themes)).toEqual(["Écologie", "Énergie"]);
  });

  it("ne devrait pas prendre les consignes de charte pour des thèmes", () => {
    const out = parseThemePromptText(
      "- Couleur principale : bleu marine\n- Police des titres : Georgia\n- Le numérique\n- La santé",
      CURRENT,
    );
    expect(names(out.themes)).toEqual(["Le numérique", "La santé"]);
    expect(out.brand?.colors.primary).toBe("#1F3A5F");
    expect(out.brand?.fonts.heading).toBe("Georgia");
  });

  it("devrait borner les thèmes (60 au plus, nom ≤ 120, schéma respecté)", () => {
    const text = Array.from({ length: 70 }, (_, i) => `- Thème numéro ${i + 1} ${"x".repeat(i === 0 ? 200 : 0)}`).join("\n");
    const out = parseThemePromptText(text, CURRENT);
    expect(out.themes).toHaveLength(60);
    expect(out.themes[0]!.name.length).toBeLessThanOrEqual(120);
    for (const t of out.themes) expect(ThemeInputSchema.safeParse(t).success).toBe(true);
  });

  it("devrait ignorer un nom trop court", () => {
    const out = parseThemePromptText("1. A\n2. Bien\n3. Mal", CURRENT);
    expect(names(out.themes)).toEqual(["Bien", "Mal"]);
  });
});

describe("parseThemePromptText — charte", () => {
  it("devrait reconnaître les codes hex près des rôles", () => {
    const out = parseThemePromptText(
      "Couleur principale : #1f3a5f ; couleur secondaire #C9A227. Accent : #e63. Fond #FAFAFA, texte #111111.",
      CURRENT,
    );
    expect(out.brand?.colors).toEqual({
      primary: "#1F3A5F",
      secondary: "#C9A227",
      accent: "#EE6633",
      background: "#FAFAFA",
      text: "#111111",
    });
    expect(out.brandFound).toEqual(
      expect.arrayContaining([
        "Couleur principale : #1F3A5F",
        "Couleur secondaire : #C9A227",
        "Couleur d'accent : #EE6633",
        "Couleur de fond : #FAFAFA",
        "Couleur du texte : #111111",
      ]),
    );
  });

  it("devrait reconnaître des noms de couleur (FR et EN), y compris accordés", () => {
    const out = parseThemePromptText("Le texte en noir sur fond blanc, couleur principale vert foncé, accent orange.", CURRENT);
    expect(out.brand?.colors.text).toBe("#000000");
    expect(out.brand?.colors.background).toBe("#FFFFFF");
    expect(out.brand?.colors.primary).toBe("#1B5E20");
    expect(out.brand?.colors.accent).toBe("#F57C00");
    expect(parseThemePromptText("Background: navy blue", CURRENT).brand?.colors.background).toBe("#1F3A5F");
    expect(parseThemePromptText("La couleur principale sera noire.", CURRENT).brand?.colors.primary).toBe("#000000");
  });

  it("devrait répartir « Couleurs : X et Y » sur principale puis secondaire", () => {
    const out = parseThemePromptText("Couleurs : bordeaux et doré", CURRENT);
    expect(out.brand?.colors.primary).toBe("#800020");
    expect(out.brand?.colors.secondary).toBe("#D4AF37");
    expect(out.brand?.colors.accent).toBe(CURRENT.colors.accent);
  });

  it("ne devrait pas lire une couleur dans un thème", () => {
    const out = parseThemePromptText("1. L'or noir et la géopolitique\n2. Le vert dans la ville", CURRENT);
    expect(out.brand).toBeNull();
  });

  it("devrait reconnaître les polices sûres citées, par rôle", () => {
    const out = parseThemePromptText("Police des titres : Georgia, texte en Open Sans.", CURRENT);
    expect(out.brand?.fonts).toEqual({ heading: "Georgia", body: "Open Sans" });
    expect(out.brandFound).toEqual(expect.arrayContaining(["Police des titres : Georgia", "Police du texte : Open Sans"]));
  });

  it("une seule police sans rôle vaut pour les titres et le texte", () => {
    expect(parseThemePromptText("Typographie : Poppins.", CURRENT).brand?.fonts).toEqual({ heading: "Poppins", body: "Poppins" });
  });

  it("devrait compléter depuis la charte actuelle et garder son nom et son logo", () => {
    const withLogo = { ...CURRENT, logoDataUrl: "data:image/png;base64,AAAA" };
    const out = parseThemePromptText("Couleur principale : #003366", withLogo);
    expect(out.brand).toEqual({ ...withLogo, colors: { ...withLogo.colors, primary: "#003366" } });
    expect(BrandSchema.safeParse(out.brand).success).toBe(true);
  });

  it("devrait corriger un contraste texte/fond insuffisant, avec une note", () => {
    const out = parseThemePromptText("Fond noir.", CURRENT);
    expect(out.brand?.colors.background).toBe("#000000");
    expect(contrastRatio(out.brand!.colors.text, out.brand!.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(out.brandNotes.join(" ")).toMatch(/Contraste/);
  });

  it("rien de reconnu : aucun thème, aucune charte", () => {
    const out = parseThemePromptText("Bonjour, je prépare mon oral.", CURRENT);
    expect(out).toEqual({ themes: [], brand: null, brandNotes: [], brandFound: [] });
  });
});

describe("parseThemePromptText — nom de couleur suivi de son code", () => {
  it("devrait lire « bleu marine #1F3A5F et jaune #F4AD15 » comme deux couleurs, codes respectés", () => {
    const { brand } = parseThemePromptText(
      "Thèmes : 1. Cybersécurité 2. IA. Couleurs : bleu marine #1F3A5F et jaune #F4AD15, police Georgia.",
      defaultBrand(),
    );
    expect(brand?.colors.primary).toBe("#1F3A5F");
    expect(brand?.colors.secondary).toBe("#F4AD15");
    expect(Object.values(brand?.colors ?? {})).not.toContain("#FBC02D");
  });

  it("devrait accepter le code entre parenthèses : « rouge (#B71C1C) »", () => {
    const { brand } = parseThemePromptText("Thèmes : 1. A 2. B. Couleur principale : rouge (#B71C1C).", defaultBrand());
    expect(brand?.colors.primary).toBe("#B71C1C");
  });
});
