import { describe, expect, it } from "vitest";
import { defaultBrand, defaultSections, defaultTemplate } from "@/domain/defaults";
import { BrandSchema, PromptTemplateSchema } from "@/domain/schemas";

describe("defaultTemplate", () => {
  it("devrait produire un gabarit valide selon PromptTemplateSchema", () => {
    expect(PromptTemplateSchema.safeParse(defaultTemplate()).success).toBe(true);
  });

  it("devrait proposer les sections intro, problem, plan, part1, part2, part3, conclusion dans cet ordre", () => {
    expect(defaultTemplate().sections.map((s) => s.id)).toEqual([
      "intro",
      "problem",
      "plan",
      "part1",
      "part2",
      "part3",
      "conclusion",
    ]);
  });

  it("devrait être en français, au format 16:9, pour un oral de 20 minutes", () => {
    const template = defaultTemplate();
    expect(template.language).toBe("fr");
    expect(template.format).toBe("16:9");
    expect(template.durationMinutes).toBe(20);
  });

  it("devrait renvoyer un nouvel objet à chaque appel quand on modifie le précédent", () => {
    const first = defaultTemplate();
    first.sections.pop();
    expect(defaultTemplate().sections).toHaveLength(7);
  });
});

describe("defaultBrand", () => {
  it("devrait produire une charte valide selon BrandSchema", () => {
    expect(BrandSchema.safeParse(defaultBrand()).success).toBe(true);
  });

  it("devrait être une charte neutre sans logo", () => {
    expect(defaultBrand().logoDataUrl).toBeNull();
  });
});

describe("defaultSections", () => {
  it("devrait renvoyer les mêmes sections que defaultTemplate()", () => {
    expect(defaultSections()).toEqual(defaultTemplate().sections);
  });
});
