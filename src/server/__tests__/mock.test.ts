import { describe, expect, it } from "vitest";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { DeckSpecSchema } from "@/domain/schemas";
import { createMockProvider } from "@/server/ai/mock";
import { makeTemplate, makeThemes } from "@/test/fixtures";

describe("fournisseur mock", () => {
  it("devrait produire un deck valide et conforme même avec des consignes de section très longues", async () => {
    const template = makeTemplate({
      sections: makeTemplate().sections.map((s) => ({ ...s, guidance: "Consigne détaillée ".repeat(30).slice(0, 600) })),
    });
    const deck = await createMockProvider().generateDeck(
      { system: "", user: "" },
      { template, theme: makeThemes()[0]!, programName: "P", problem: "Une problématique ".repeat(80).slice(0, 1500) },
    );
    expect(DeckSpecSchema.safeParse(deck).success).toBe(true);
    expect(checkDeckAgainstTemplate(deck, template)).toEqual([]);
  });
});
