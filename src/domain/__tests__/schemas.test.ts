import { describe, expect, it } from "vitest";
import { SAFE_FONTS } from "@/domain/fonts";
import {
  BrandSchema,
  DeckSpecSchema,
  PasswordSchema,
  ProblemInputSchema,
  PromptTemplateSchema,
  SectionSchema,
  SlideSchema,
  ThemeInputSchema,
} from "@/domain/schemas";
import { defaultTemplate } from "@/domain/defaults";
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
      message: "La trame dépasse 60 diapos : réduisez le nombre de diapos par ligne.",
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

  it("devrait expliquer la longueur minimale du nom de sujet", () => {
    const result = ThemeInputSchema.safeParse({ name: "x" });
    expect(firstMessage(result)?.message).toBe("Le nom du sujet doit faire au moins 2 caractères.");
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

describe("ThemeInputSchema — notes du sujet", () => {
  it("devrait accepter 4000 caractères de notes et refuser le 4001e avec un message", () => {
    expect(ThemeInputSchema.safeParse({ name: "Énergie", notes: "x".repeat(4000) }).success).toBe(true);
    const result = ThemeInputSchema.safeParse({ name: "Énergie", notes: "x".repeat(4001) });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toMatchObject({
      path: ["notes"],
      message: "Les notes ne doivent pas dépasser 4000 caractères.",
    });
  });

  it("devrait conserver les sauts de ligne des notes et retirer les caractères de contrôle", () => {
    const parsed = ThemeInputSchema.parse({ name: "Énergie", notes: `  42 % d'EnR\n- Source : ADEME${CONTROL}\n\tfin  ` });
    expect(parsed.notes).toBe("42 % d'EnR\n- Source : ADEME\n\tfin");
  });

  it("devrait donner des notes vides par défaut (sujets v1.0)", () => {
    expect(ThemeInputSchema.parse({ name: "Énergie" }).notes).toBe("");
  });
});

describe("SectionSchema — durée d'une ligne de trame", () => {
  const line = { id: "intro", title: "Introduction", guidance: "", slides: 1 };

  it.each([
    ["refuser", 9, false],
    ["accepter", 10, true],
    ["accepter", 5400, true],
    ["refuser", 5401, false],
    ["refuser", 12.5, false],
  ] as const)("devrait %s une durée de %s s", (_verdict, seconds, ok) => {
    expect(SectionSchema.safeParse({ ...line, seconds }).success).toBe(ok);
  });

  it("devrait expliquer la durée minimale", () => {
    expect(firstMessage(SectionSchema.safeParse({ ...line, seconds: 9 }))?.message).toBe("Une ligne dure au moins 10 secondes.");
  });

  it("devrait accepter une ligne sans durée, sans ajouter la clé", () => {
    const parsed = SectionSchema.parse(line);
    expect(parsed).not.toHaveProperty("seconds");
  });
});

describe("PromptTemplateSchema — somme des durées", () => {
  // 20 min, 13 diapos : couverture = min(30, 1200 / 13) = 30 s ; reste 1170 s pour les lignes.
  function withSeconds(first: number) {
    const sections = defaultTemplate().sections.map((s, i) => (i === 0 ? { ...s, seconds: first } : s));
    return { ...defaultTemplate(), sections };
  }

  /** Diapos des lignes sans durée quand seule la première ligne en a une. */
  const freeSlides = defaultTemplate().sections.slice(1).reduce((sum, s) => sum + s.slides, 0);

  it("devrait accepter des durées qui remplissent exactement le temps disponible quand toutes les lignes en ont une", () => {
    const template = defaultTemplate();
    const per = Math.floor(1170 / template.sections.length);
    const sections = template.sections.map((s, i) => ({
      ...s,
      seconds: i === 0 ? 1170 - per * (template.sections.length - 1) : per,
    }));
    expect(PromptTemplateSchema.safeParse({ ...template, sections }).success).toBe(true);
  });

  it("devrait laisser au moins 10 s par diapo aux lignes sans durée", () => {
    expect(PromptTemplateSchema.safeParse(withSeconds(1170 - freeSlides * 10)).success).toBe(true);
    const result = PromptTemplateSchema.safeParse(withSeconds(1170 - freeSlides * 10 + 1));
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toMatchObject({
      path: ["sections"],
      message: "Les lignes sans durée n'ont plus assez de temps (10 s par diapo au moins) : réduisez les durées fixées ou allongez l'oral.",
    });
  });

  it("devrait refuser des durées qui dépassent le temps disponible (1171 s) sur le chemin sections", () => {
    const result = PromptTemplateSchema.safeParse(withSeconds(1171));
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toMatchObject({
      path: ["sections"],
      message: "La durée des lignes dépasse celle de l'oral : réduisez les durées ou allongez l'oral.",
    });
  });

  it("devrait additionner les durées de plusieurs lignes", () => {
    const template = defaultTemplate();
    // Les lignes suivantes, sans durée, gardent 10 s par diapo.
    const reserved = template.sections.slice(2).reduce((sum, s) => sum + s.slides, 0) * 10;
    const second = 1170 - 600 - reserved;
    template.sections[0] = { ...template.sections[0]!, seconds: 600 };
    template.sections[1] = { ...template.sections[1]!, seconds: second + 1 };
    expect(PromptTemplateSchema.safeParse(template).success).toBe(false);
    template.sections[1] = { ...template.sections[1]!, seconds: second };
    expect(PromptTemplateSchema.safeParse(template).success).toBe(true);
  });
});

describe("PromptTemplateSchema — compatibilité des gabarits v1.0.1", () => {
  /** Copie littérale du JSON stocké par la v1.0.1 (defaultTemplate d'alors) : aucune clé `seconds`. */
  const V1_TEMPLATE_JSON = `{
    "format": "16:9",
    "language": "fr",
    "durationMinutes": 20,
    "sections": [
      { "id": "intro", "title": "Introduction", "guidance": "Accroche (fait, chiffre ou situation concrète), contexte et définition des termes clés.", "slides": 1 },
      { "id": "problem", "title": "Problématique", "guidance": "Énoncer la question de façon claire, en montrer l'enjeu et la tension.", "slides": 1 },
      { "id": "plan", "title": "Annonce du plan", "guidance": "Présenter les trois axes en une phrase chacun, dans l'ordre où ils seront traités.", "slides": 1 },
      { "id": "part1", "title": "Premier axe", "guidance": "Constat : état des lieux étayé par des données et un exemple précis.", "slides": 3 },
      { "id": "part2", "title": "Deuxième axe", "guidance": "Analyse : causes, mécanismes, points de vue en présence.", "slides": 3 },
      { "id": "part3", "title": "Troisième axe", "guidance": "Perspectives : leviers d'action, limites et conditions de réussite.", "slides": 2 },
      { "id": "conclusion", "title": "Conclusion", "guidance": "Réponse explicite à la problématique, synthèse des axes, ouverture.", "slides": 1 }
    ],
    "tone": "Clair, structuré et argumenté, niveau master",
    "constraints": "Au plus six puces courtes par diapo. Chaque partie s'appuie sur au moins un exemple concret."
  }`;

  it("devrait relire un gabarit v1.0.1 tel quel et le réécrire sans clé seconds", () => {
    const stored: unknown = JSON.parse(V1_TEMPLATE_JSON);
    const result = PromptTemplateSchema.safeParse(stored);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(stored);
    expect(JSON.stringify(result.data)).not.toContain('"seconds"');
  });
});
