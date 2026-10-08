import { describe, expect, it } from "vitest";
import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import { EXAMPLE_PROJECT_NAME, exampleProject } from "@/domain/examples";
import { buildProjectExport, parseProjectExport, serializeProjectExport } from "@/domain/project-export";
import { sectionKind } from "@/domain/free/outline";
import { BrandSchema, PromptTemplateSchema, ThemeInputSchema } from "@/domain/schemas";

describe("exampleProject", () => {
  it("devrait porter le nom « Grand oral MAALSI (exemple) »", () => {
    expect(EXAMPLE_PROJECT_NAME).toBe("Grand oral MAALSI (exemple)");
    expect(exampleProject().name).toBe(EXAMPLE_PROJECT_NAME);
  });

  it("devrait porter l'apparence CESI : noir, jaune CESI, Arial, sans logo", () => {
    const { brand } = exampleProject();
    expect(BrandSchema.safeParse(brand).success).toBe(true);
    expect(brand).toEqual({
      name: "CESI",
      colors: { primary: "#111111", secondary: "#333333", accent: "#FBE216", background: "#FFFFFF", text: "#222222" },
      fonts: { heading: "Arial", body: "Arial" },
      logoDataUrl: null,
    });
    expect(brand).not.toEqual(defaultBrand());
  });

  it("devrait proposer une trame générique de grand oral, valide, de 12 diapos couverture comprise", () => {
    const { template } = exampleProject();
    expect(PromptTemplateSchema.safeParse(template).success).toBe(true);
    expect(template.sections.map((s) => [s.id, s.slides])).toEqual([
      ["problem", 1],
      ["intro", 1],
      ["part1", 2],
      ["part2", 4],
      ["part3", 2],
      ["conclusion", 1],
    ]);
    expect(1 + template.sections.reduce((n, s) => n + s.slides, 0)).toBe(12);
    // Les lignes sont reconnues pour ce qu'elles sont (problématique, introduction, parties, conclusion).
    expect(template.sections.map(sectionKind)).toEqual(["problem", "intro", "part", "part", "part", "conclusion"]);
    // Générique : aucun nom propre du support d'origine.
    expect(JSON.stringify(template)).not.toMatch(/keolis|big data|power bi|bus/i);
    expect(template).not.toEqual(defaultTemplate());
  });

  it("devrait proposer 3 sujets valides, chacun avec description, mots-clés, notes et 2 à 3 problématiques", () => {
    const { themes } = exampleProject();
    expect(themes).toHaveLength(3);
    for (const theme of themes) {
      expect(ThemeInputSchema.safeParse(theme).success).toBe(true);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.keywords.length).toBeGreaterThanOrEqual(3);
      expect(theme.notes).toMatch(/exemple/i);
      expect(theme.problems.length).toBeGreaterThanOrEqual(2);
      expect(theme.problems.length).toBeLessThanOrEqual(3);
    }
    expect(new Set(themes.map((t) => t.name)).size).toBe(3);
  });

  it("devrait passer par le format d'export sans perte (aucun diaporama)", () => {
    const project = exampleProject();
    expect(project.decks).toEqual([]);
    const parsed = parseProjectExport(serializeProjectExport(buildProjectExport(project, new Date())));
    expect(parsed).toEqual({ ok: true, project });
  });

  it("devrait renvoyer un objet neuf à chaque appel", () => {
    const first = exampleProject();
    first.themes.pop();
    expect(exampleProject().themes).toHaveLength(3);
  });
});
