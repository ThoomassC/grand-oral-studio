import { describe, expect, it } from "vitest";
import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import { EXAMPLE_PROJECT_NAME, exampleProject } from "@/domain/examples";
import { buildProjectExport, parseProjectExport, serializeProjectExport } from "@/domain/project-export";
import { BrandSchema, PromptTemplateSchema, ThemeInputSchema } from "@/domain/schemas";

describe("exampleProject", () => {
  it("devrait porter le nom « Grand oral MAALSI (exemple) »", () => {
    expect(EXAMPLE_PROJECT_NAME).toBe("Grand oral MAALSI (exemple)");
    expect(exampleProject().name).toBe(EXAMPLE_PROJECT_NAME);
  });

  it("devrait reprendre l'apparence et la trame par défaut, valides", () => {
    const project = exampleProject();
    expect(project.brand).toEqual(defaultBrand());
    expect(project.template).toEqual(defaultTemplate());
    expect(BrandSchema.safeParse(project.brand).success).toBe(true);
    expect(PromptTemplateSchema.safeParse(project.template).success).toBe(true);
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
