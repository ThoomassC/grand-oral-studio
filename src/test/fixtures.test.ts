import { describe, expect, it } from "vitest";
import { BrandSchema, DeckSpecSchema, PromptTemplateSchema } from "@/domain/schemas";
import { makeBrand, makeConformingDeck, makeTemplate, TINY_PNG_DATA_URL } from "./fixtures";

describe("fixtures de test", () => {
  it("devrait fournir un gabarit valide selon PromptTemplateSchema", () => {
    expect(PromptTemplateSchema.safeParse(makeTemplate()).success).toBe(true);
  });

  it("devrait fournir une charte valide selon BrandSchema, avec ou sans logo", () => {
    expect(BrandSchema.safeParse(makeBrand()).success).toBe(true);
    expect(BrandSchema.safeParse(makeBrand({ logoDataUrl: TINY_PNG_DATA_URL })).success).toBe(true);
  });

  it("devrait fournir un deck valide selon DeckSpecSchema", () => {
    expect(DeckSpecSchema.safeParse(makeConformingDeck()).success).toBe(true);
  });
});
