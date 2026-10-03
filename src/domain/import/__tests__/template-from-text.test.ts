import { describe, expect, it } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import { normalizeTemplateDraft, parseTemplateText } from "@/domain/import/template-from-text";
import { MAX_TEMPLATE_SLIDES, PromptTemplateSchema, type PromptTemplate } from "@/domain/schemas";
import { totalSlides } from "@/domain/slides";

const base = defaultTemplate();

function parse(text: string, b: PromptTemplate = base) {
  const r = parseTemplateText(text, b);
  expect(PromptTemplateSchema.safeParse(r.template).success).toBe(true);
  return r;
}

describe("parseTemplateText — durée", () => {
  it.each([
    ["Oral de 20 min", 20],
    ["Durée : 20 minutes", 20],
    ["1 h 30 de présentation", 90],
    ["1h15", 75],
    ["Talk of 12 minutes", 12],
  ])("%s → %i min", (text, minutes) => {
    const r = parse(text);
    expect(r.template.durationMinutes).toBe(minutes);
    expect(r.found).toContain(`Durée : ${minutes} min`);
  });

  it("devrait borner une durée hors limites (3..90) en le signalant", () => {
    const long = parse("Durée : 120 min");
    expect(long.template.durationMinutes).toBe(90);
    expect(long.warnings.some((w) => /120 min/.test(w) && /90 min/.test(w))).toBe(true);
    expect(parse("Durée : 1 min").template.durationMinutes).toBe(3);
    // Une durée en heures au-delà de 2 h n'est pas une durée d'oral : ignorée et signalée (voir template-from-text.review.test.ts).
  });
});

describe("parseTemplateText — format, langue, ton", () => {
  it("devrait reconnaître le format", () => {
    expect(parse("Format 4:3 imposé").template.format).toBe("4:3");
    expect(parse("diapos en 16/9").template.format).toBe("16:9");
    expect(parse("Format 4:3").found).toContain("Format : 4:3");
  });

  it("devrait reconnaître la langue", () => {
    expect(parse("Langue : anglais").template.language).toBe("en");
    expect(parse("The talk must be in English.").template.language).toBe("en");
    expect(parse("Présentation en français").template.language).toBe("fr");
    expect(parse("Langue : anglais").found).toContain("Langue : anglais");
  });

  it("devrait reconnaître le ton", () => {
    const r = parse("Ton : professionnel et dynamique");
    expect(r.template.tone).toBe("professionnel et dynamique");
    expect(r.found).toContain("Ton");
  });
});

describe("parseTemplateText — sections", () => {
  it("devrait lire une liste numérotée avec le nombre de diapos", () => {
    const r = parse(
      [
        "Durée : 20 min",
        "1. Introduction (1 diapo)",
        "2. Contexte et enjeux (2 diapos)",
        "3. Analyse : forces et faiblesses (3 slides)",
        "4. Conclusion",
      ].join("\n"),
    );
    expect(r.template.sections.map((s) => [s.title, s.slides])).toEqual([
      ["Introduction", 1],
      ["Contexte et enjeux", 2],
      ["Analyse", 3],
      ["Conclusion", 1],
    ]);
    expect(r.template.sections[2]!.guidance).toBe("forces et faiblesses");
    expect(r.found).toContain("4 sections");
    expect(new Set(r.template.sections.map((s) => s.id)).size).toBe(4);
  });

  it("devrait lire des puces et des titres Markdown", () => {
    expect(parse("- Accroche\n- Développement (3 diapos)\n- Ouverture").template.sections).toHaveLength(3);
    const md = parse("## Introduction\nPoser le sujet.\n## Partie 1 — 2 slides\nArguments.\n## Conclusion");
    expect(md.template.sections.map((s) => s.title)).toEqual(["Introduction", "Partie 1", "Conclusion"]);
    expect(md.template.sections[0]!.guidance).toBe("Poser le sujet.");
    expect(md.template.sections[1]!.slides).toBe(2);
  });

  it("devrait garder les sections de base quand aucune liste n'est reconnue", () => {
    expect(parse("Durée : 20 min").template.sections).toEqual(base.sections);
  });

  it("devrait respecter les bornes : 30 sections, 8 diapos par section, 60 diapos au total — en le signalant", () => {
    const many = Array.from({ length: 20 }, (_, i) => `${i + 1}. Partie ${i + 1} (8 diapos)`).join("\n");
    const r = parse(many);
    expect(r.template.sections).toHaveLength(20);
    expect(r.template.sections.every((s) => s.slides >= 1 && s.slides <= 8)).toBe(true);
    expect(totalSlides(r.template)).toBe(MAX_TEMPLATE_SLIDES);
    expect(r.warnings.some((w) => /60 diapos/.test(w))).toBe(true);
  });

  it("devrait tronquer les titres trop longs", () => {
    const r = parse(`1. ${"Très long ".repeat(30)}\n2. Fin`);
    expect(r.template.sections[0]!.title.length).toBeLessThanOrEqual(80);
  });
});

describe("parseTemplateText — contraintes et cas limites", () => {
  it("devrait mettre le reste du texte dans les contraintes", () => {
    const r = parse("Durée : 20 min\nCiter au moins deux sources.\nPas plus de 5 puces par diapo.");
    expect(r.template.constraints).toBe("Citer au moins deux sources.\nPas plus de 5 puces par diapo.");
    expect(r.found).toContain("Contraintes");
  });

  it("devrait tronquer les contraintes à 2 000 caractères", () => {
    expect(parse("x".repeat(5_000)).template.constraints.length).toBeLessThanOrEqual(2_000);
  });

  it("devrait renvoyer la base inchangée et found vide quand rien n'est reconnu", () => {
    const r = parse("   \n\n ");
    expect(r.found).toEqual([]);
    expect(r.template).toEqual(base);
  });
});

describe("normalizeTemplateDraft (sortie IA permissive)", () => {
  it("devrait normaliser une sortie IA approximative en gabarit valide", () => {
    const { template, found } = normalizeTemplateDraft(
      {
        durationMinutes: 200,
        format: "16/9",
        language: "English",
        sections: [{ title: "Intro", slides: 0 }, { title: "", slides: 3 }, { title: "Partie", guidance: "g".repeat(900), slides: 12 }],
        tone: "t".repeat(500),
      },
      base,
    );
    expect(PromptTemplateSchema.safeParse(template).success).toBe(true);
    expect(template.durationMinutes).toBe(90);
    expect(template.language).toBe("en");
    expect(template.sections.map((s) => s.title)).toEqual(["Intro", "Partie"]);
    expect(template.sections.map((s) => s.slides)).toEqual([1, 8]);
    expect(found).toContain("2 sections");
  });

  it("devrait garder la base pour les champs absents", () => {
    const { template, found } = normalizeTemplateDraft({}, base);
    expect(template).toEqual(base);
    expect(found).toEqual([]);
  });
});

describe("parseTemplateText — prompt collé sur une seule ligne", () => {
  const oneLine =
    "Oral de 20 minutes en 16:9. Sections : 1. Introduction (1 diapo) 2. Problématique (1 diapo) 3. Développement en deux parties (4 diapos) 4. Conclusion (1 diapo). Ton : professionnel.";

  it("devrait reconnaître les sections numérotées et le ton comme si chaque consigne était sur sa ligne", () => {
    const { template, found } = parseTemplateText(oneLine, defaultTemplate());
    expect(template.sections.map((s) => [s.title, s.slides])).toEqual([
      ["Introduction", 1],
      ["Problématique", 1],
      ["Développement en deux parties", 4],
      ["Conclusion", 1],
    ]);
    expect(template.tone).toBe("professionnel");
    expect(template.durationMinutes).toBe(20);
    expect(template.format).toBe("16:9");
    expect(found).toEqual(expect.arrayContaining(["Ton"]));
    expect(found.some((f) => /4 sections/.test(f))).toBe(true);
  });

  it("ne devrait pas couper un format ou une durée comme « 16:9. » ou « 1 h 30. »", () => {
    const { template } = parseTemplateText("Format 16:9. Durée 1 h 30. Sections : 1. Intro 2. Conclusion", defaultTemplate());
    expect(template.format).toBe("16:9");
    expect(template.durationMinutes).toBe(90);
    expect(template.sections.map((s) => s.title)).toEqual(["Intro", "Conclusion"]);
  });
});
