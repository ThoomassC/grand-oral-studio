import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import { buildTemplateDraftPrompt } from "@/domain/import/prompts";
import { normalizeTemplateDraft, normalizeTone, parseTemplateText } from "@/domain/import/template-from-text";
import { LIMITS, PromptTemplateSchema } from "@/domain/schemas";
import { totalSlides } from "@/domain/slides";

/**
 * Prompts Markdown structurés (cas réel : « Générer un deck d'oral dans Canva »,
 * tableau d'architecture de 31 diapos, règles de contenu, bloc d'entrées à remplir).
 */

const base = defaultTemplate();
const canva = readFileSync(join(__dirname, "prompt-oral-canva.fixture.md"), "utf8");

function parse(text: string) {
  const r = parseTemplateText(text, base);
  expect(PromptTemplateSchema.safeParse(r.template).success).toBe(true);
  return r;
}

describe("parseTemplateText — tableau Markdown de diapos", () => {
  it("devrait lire chaque ligne du tableau comme une section, avec son rôle comme consigne", () => {
    const r = parse(
      [
        "| # | Diapo | Rôle |",
        "|---|---|---|",
        "| 1 | **Accroche** | Un chiffre qui crée la tension |",
        "| 2-4 | **Partie I — le constat** | Le constat mesuré |",
        "| 5 | *Intercalaire* | |",
        "| 6 | **Conclusion** | Réponse frontale |",
      ].join("\n"),
    );
    expect(r.template.sections.map((s) => [s.title, s.slides, s.guidance])).toEqual([
      ["Accroche", 1, "Un chiffre qui crée la tension"],
      ["Partie I — le constat", 3, "Le constat mesuré"],
      ["Intercalaire", 1, ""],
      ["Conclusion", 1, "Réponse frontale"],
    ]);
    expect(r.recognized).toContain("sections");
  });

  it("ne devrait pas prendre pour des diapos un tableau sans colonne de numéros", () => {
    const r = parse(["| Logique | Figure |", "|---|---|", "| A recule | Opposition |", "| étapes | Frise |"].join("\n"));
    expect(r.template.sections).toEqual(base.sections);
    expect(r.recognized).not.toContain("sections");
  });

  it("devrait écarter une ligne « Couverture » (déjà ajoutée par l'application) et le signaler", () => {
    const r = parse(
      ["| # | Diapo | Rôle |", "|---|---|---|", "| 1 | **Couverture** | Titre + sous-titre |", "| 2 | Plan | Les parties |", "| 3 | Conclusion | Réponse |"].join("\n"),
    );
    expect(r.template.sections.map((s) => s.title)).toEqual(["Plan", "Conclusion"]);
    expect(r.warnings.some((w) => /Couverture/.test(w) && /ajout/.test(w))).toBe(true);
    // La consigne de couverture n'est pas perdue.
    expect(r.template.constraints).toMatch(/Couverture : Titre \+ sous-titre/);
  });
});

describe("parseTemplateText — prompt réel « deck d'oral dans Canva »", () => {
  const r = parse(canva);
  const titles = r.template.sections.map((s) => s.title);

  it("devrait produire les 31 diapos de l'architecture (couverture comprise)", () => {
    expect(totalSlides(r.template)).toBe(31);
    expect(r.template.sections).toHaveLength(16);
  });

  it("devrait garder la fin du plan : Réponses, Conclusion, Ouverture", () => {
    expect(titles.slice(-3)).toEqual(["Les réponses", "Conclusion", "Ouverture"]);
    expect(titles[0]).toBe("Présentation");
  });

  it("devrait convertir les plages « 9-12 » en nombre de diapos", () => {
    const slides = Object.fromEntries(r.template.sections.map((s) => [s.title, s.slides]));
    expect(slides["Partie I — l'état des lieux"]).toBe(4);
    expect(slides["Partie II — le déplacement"]).toBe(5);
    expect(slides["Partie III — les fronts"]).toBe(8);
  });

  it("ne devrait pas créer de section pour le titre du document, les entrées à remplir ou la mission", () => {
    expect(titles.join(" | ")).not.toMatch(/Générer un deck|Entrées|Ta mission|Architecture narrative|Règles de contenu/);
  });

  it("ne devrait laisser aucune syntaxe Markdown dans les titres, consignes et contraintes", () => {
    const texts = [...r.template.sections.flatMap((s) => [s.title, s.guidance]), r.template.constraints];
    for (const t of texts) expect(t).not.toMatch(/\*\*|`|^#{1,6}\s|\|\s*---|^---$/m);
  });

  it("devrait reprendre les règles de contenu dans les contraintes", () => {
    const c = r.template.constraints;
    expect(c).toMatch(/Un chiffre par diapo, jamais trois/);
    expect(c).toMatch(/12 mots/);
    expect(c).toMatch(/Ne fabrique aucun chiffre/);
    expect(c).toMatch(/Objection probable/);
    expect(c.length).toBeLessThanOrEqual(2000);
    // Les entrées à remplir n'y sont pas.
    expect(c).not.toMatch(/THÈME\s*:\s*…/);
  });

  it("devrait signaler les blocs du prompt non repris dans les contraintes (limite de 2 000 caractères)", () => {
    expect(r.warnings.some((w) => /non repris/.test(w) && /API Canva/.test(w))).toBe(true);
  });

  it("devrait reconnaître le format 1920×1080 comme 16:9 et ne pas inventer de durée", () => {
    expect(r.recognized).toContain("format");
    expect(r.template.format).toBe("16:9");
    expect(r.recognized).not.toContain("durationMinutes");
    expect(r.found.some((f) => f.startsWith("Durée"))).toBe(false);
    expect(r.warnings.some((w) => /durée/i.test(w) && /20 min/.test(w))).toBe(true);
  });

  it("devrait consigner la consigne de la couverture plutôt qu'une section Couverture", () => {
    expect(titles).not.toContain("Couverture");
    expect(r.template.constraints).toMatch(/Couverture : Titre du sujet/);
  });
});

describe("parseTemplateText — titres numérotés « ## 1. … »", () => {
  it("ne devrait pas couper un titre Markdown numéroté", () => {
    const r = parse("## 1. Introduction\nPoser le sujet.\n## 2. Développement\nArguments.\n## 3. Conclusion\nRépondre.");
    expect(r.template.sections.map((s) => s.title)).toEqual(["Introduction", "Développement", "Conclusion"]);
  });

  it("ne devrait pas prendre le titre du document ni un bloc d'entrées pour des sections", () => {
    const r = parse(
      ["# Mon oral", "## Entrées (à remplir)", "- **THÈME** : …", "## Introduction", "Accroche.", "## Conclusion", "Réponse."].join("\n"),
    );
    expect(r.template.sections.map((s) => s.title)).toEqual(["Introduction", "Conclusion"]);
    expect(r.template.constraints).not.toMatch(/THÈME/);
  });
});

describe("bornes des sections : jamais de coupe silencieuse", () => {
  it("devrait accepter jusqu'à 30 sections", () => {
    const many = Array.from({ length: 30 }, (_, i) => `${i + 1}. Partie ${i + 1}`).join("\n");
    const r = parse(many);
    expect(r.template.sections).toHaveLength(LIMITS.maxSections);
    expect(r.warnings.filter((w) => /section/.test(w))).toEqual([]);
  });

  it("au-delà, devrait garder la fin du plan (conclusion) et lister les sections coupées", () => {
    const many = [...Array.from({ length: 33 }, (_, i) => `${i + 1}. Partie ${i + 1}`), "34. Conclusion", "35. Ouverture"].join("\n");
    const r = parse(many);
    const titles = r.template.sections.map((s) => s.title);
    expect(titles).toHaveLength(30);
    expect(titles.slice(-2)).toEqual(["Conclusion", "Ouverture"]);
    const warning = r.warnings.find((w) => /30 sections/.test(w));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/Partie 33/);
  });

  it("devrait signaler une section ramenée à 8 diapos", () => {
    const r = parse("1. Intro\n2. Développement (12 diapos)\n3. Conclusion");
    expect(r.template.sections[1]!.slides).toBe(8);
    expect(r.warnings.some((w) => /Développement/.test(w) && /8/.test(w))).toBe(true);
  });
});

describe("normalizeTemplateDraft — réponse IA (cas Ollama réel)", () => {
  // Réponse brute observée de qwen2.5:14b sur le prompt réel (17 sections, durée recopiée, ton en anglais).
  const raw = {
    durationMinutes: 20,
    format: "16:9",
    language: "fr",
    tone: "Formal",
    sections: [
      ["Couverture", 1], ["Présentation", 1], ["Sommaire", 1], ["Chiffre d'accroche", 1], ["Définitions", 1],
      ["Frise historique", 1], ["Problématique", 1], ["Intercalaire Partie I", 1], ["État des lieux", 4],
      ["Intercalaire Partie II", 1], ["Déplacement", 5], ["Intercalaire Partie III", 1], ["Enjeux", 1],
      ["Fronts", 8], ["Réponses", 1], ["Conclusion", 1], ["Ouverture", 1],
    ].map(([title, slides]) => ({ title: String(title), slides: Number(slides), guidance: "" })),
  };

  it("devrait garder Conclusion et Ouverture et retirer la Couverture", () => {
    const r = normalizeTemplateDraft(raw, base, canva);
    const titles = r.template.sections.map((s) => s.title);
    expect(titles.slice(-2)).toEqual(["Conclusion", "Ouverture"]);
    expect(titles).not.toContain("Couverture");
    expect(totalSlides(r.template)).toBe(31);
    expect(r.warnings.some((w) => /Couverture/.test(w))).toBe(true);
  });

  it("ne devrait pas annoncer reconnue une durée que le texte ne fixe pas", () => {
    const r = normalizeTemplateDraft(raw, base, canva);
    expect(r.recognized).not.toContain("durationMinutes");
    expect(r.found.some((f) => f.startsWith("Durée"))).toBe(false);
    expect(r.template.durationMinutes).toBe(base.durationMinutes);
    expect(r.warnings.some((w) => /durée/i.test(w))).toBe(true);
  });

  it("devrait garder une durée que le texte fixe", () => {
    const r = normalizeTemplateDraft({ durationMinutes: 15 }, base, "Oral de 15 minutes.");
    expect(r.recognized).toContain("durationMinutes");
    expect(r.template.durationMinutes).toBe(15);
  });

  it("devrait ramener un ton anglais en français pour un deck français", () => {
    const r = normalizeTemplateDraft(raw, base, canva);
    expect(r.template.tone).toBe("formel");
  });
});

describe("normalizeTone", () => {
  it.each([
    ["Formal", "fr", "formel"],
    ["professional and engaging", "fr", "professionnel, engageant"],
    ["Academic, concise", "fr", "académique, concis"],
    ["professionnel et dynamique", "fr", "professionnel et dynamique"],
    ["Formal", "en", "Formal"],
  ] as const)("%s (%s) → %s", (tone, lang, expected) => {
    expect(normalizeTone(tone, lang)).toBe(expected);
  });

  it("devrait écarter un ton anglais non traduisible pour un deck français", () => {
    expect(normalizeTone("witty with the audience", "fr")).toBe("");
  });
});

describe("buildTemplateDraftPrompt — consignes au modèle", () => {
  it("ne devrait pas souffler la durée ni le format du gabarit actuel (le modèle les recopiait)", () => {
    const p = buildTemplateDraftPrompt("Oral sans durée", { ...base, durationMinutes: 20 });
    expect(p.user).not.toMatch(/20 min|16:9/);
  });

  it("devrait annoncer la borne de sections, écarter la couverture et imposer la fin du plan", () => {
    const p = buildTemplateDraftPrompt("x", base);
    expect(p.system).toContain(`At most ${LIMITS.maxSections} sections`);
    expect(p.system).toMatch(/cover .*never list it as a section/i);
    expect(p.system).toMatch(/never drop the end of the plan/i);
    expect(p.system).toMatch(/9-12/);
  });
});
