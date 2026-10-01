import { describe, expect, it } from "vitest";
import { SAFE_FONTS } from "@/domain/fonts";
import {
  BrandSchema,
  DeckSpecSchema,
  PasswordSchema,
  ProblemInputSchema,
  PromptTemplateSchema,
  SlideSchema,
  ThemeInputSchema,
} from "@/domain/schemas";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";

const CONTROL = "\u0000\u0007\u000B\u001F";

function firstMessage(result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) {
  return result.error?.issues[0];
}

describe("SlideSchema", () => {
  const base = makeConformingDeck().slides[1]!;

  it("devrait retirer les caractères de contrôle du titre, du sous-titre, des puces et des notes", () => {
    const parsed = SlideSchema.parse({
      ...base,
      title: `Ti${CONTROL}tre`,
      subtitle: `Sous${CONTROL}-titre`,
      bullets: [`Pu${CONTROL}ce`],
      notes: `Ligne 1\nLigne 2${CONTROL}\tfin`,
    });
    expect(parsed.title).toBe("Titre");
    expect(parsed.subtitle).toBe("Sous-titre");
    expect(parsed.bullets).toEqual(["Puce"]);
    // Les sauts de ligne et tabulations sont conservés.
    expect(parsed.notes).toBe("Ligne 1\nLigne 2\tfin");
  });

  it("devrait refuser un titre composé uniquement de caractères de contrôle", () => {
    expect(SlideSchema.safeParse({ ...base, title: CONTROL }).success).toBe(false);
  });

  it("devrait accepter 6 puces de 180 caractères et refuser une 7e puce", () => {
    const six = Array.from({ length: 6 }, () => "x".repeat(180));
    expect(SlideSchema.safeParse({ ...base, bullets: six }).success).toBe(true);
    expect(SlideSchema.safeParse({ ...base, bullets: [...six, "septième"] }).success).toBe(false);
  });

  it("devrait refuser une puce de 181 caractères", () => {
    expect(SlideSchema.safeParse({ ...base, bullets: ["x".repeat(181)] }).success).toBe(false);
  });
});

describe("DeckSpecSchema", () => {
  it("devrait retirer les caractères de contrôle du titre et du sous-titre du deck", () => {
    const parsed = DeckSpecSchema.parse({ ...makeConformingDeck(), title: `Deck${CONTROL}`, subtitle: `Sous${CONTROL}` });
    expect(parsed.title).toBe("Deck");
    expect(parsed.subtitle).toBe("Sous");
  });
});

describe("BrandSchema", () => {
  it.each(SAFE_FONTS)("devrait accepter la police sûre %s", (font) => {
    expect(BrandSchema.safeParse(makeBrand({ fonts: { heading: font, body: font } })).success).toBe(true);
  });

  it("devrait refuser une police hors liste, y compris une tentative d'injection XML", () => {
    const result = BrandSchema.safeParse({ ...makeBrand(), fonts: { heading: 'Arial"/><x', body: "Arial" } });
    expect(result.success).toBe(false);
    expect(firstMessage(result)?.path).toEqual(["fonts", "heading"]);
  });

  it("devrait expliquer en français le format de couleur attendu", () => {
    const result = BrandSchema.safeParse({ ...makeBrand(), colors: { ...makeBrand().colors, primary: "bleu" } });
    expect(firstMessage(result)?.message).toMatch(/#RRGGBB/);
  });
});

describe("PromptTemplateSchema", () => {
  it("devrait accepter un gabarit de 60 diapos au total", () => {
    // 1 couverture + 59
    const sections = [
      ...Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, guidance: "", slides: 8 })),
      { id: "s7", title: "S7", guidance: "", slides: 3 },
    ];
    expect(PromptTemplateSchema.safeParse(makeTemplate({ sections })).success).toBe(true);
  });

  it("devrait refuser un gabarit de plus de 60 diapos avec un message sur le chemin sections", () => {
    const sections = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, guidance: "", slides: 8 }));
    const result = PromptTemplateSchema.safeParse(makeTemplate({ sections }));
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toMatchObject({
      path: ["sections"],
      message: "Le gabarit dépasse 60 diapos : réduisez le nombre de diapos par section.",
    });
  });
});

describe("messages de validation en français", () => {
  it("devrait expliquer la longueur minimale de la problématique", () => {
    const result = ProblemInputSchema.safeParse({ problem: "court" });
    expect(firstMessage(result)?.message).toBe("La problématique doit faire au moins 10 caractères.");
  });

  it("devrait expliquer la longueur maximale de la problématique", () => {
    const result = ProblemInputSchema.safeParse({ problem: "x".repeat(1501) });
    expect(firstMessage(result)?.message).toBe("La problématique ne doit pas dépasser 1500 caractères.");
  });

  it("devrait expliquer la longueur minimale du nom de thème", () => {
    const result = ThemeInputSchema.safeParse({ name: "x" });
    expect(firstMessage(result)?.message).toBe("Le nom du thème doit faire au moins 2 caractères.");
  });

  it("devrait expliquer les bornes du mot de passe", () => {
    expect(firstMessage(PasswordSchema.safeParse("court"))?.message).toBe(
      "Le mot de passe doit faire au moins 10 caractères.",
    );
    expect(firstMessage(PasswordSchema.safeParse("x".repeat(129)))?.message).toBe(
      "Le mot de passe ne doit pas dépasser 128 caractères.",
    );
    expect(PasswordSchema.safeParse("motdepasse-solide").success).toBe(true);
  });
});

describe("BrandSchema — logo", () => {
  it("refuse un logo SVG, que l'export .pptx ne sait pas rastériser", () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
    expect(BrandSchema.safeParse(makeBrand({ logoDataUrl: svg })).success).toBe(false);
  });
});
