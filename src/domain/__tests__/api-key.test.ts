import { describe, expect, it } from "vitest";
import { AnthropicApiKeySchema, apiKeyLast4 } from "@/domain/api-key";

const VALID = `sk-ant-api03-${"A".repeat(80)}_-9z`;

describe("AnthropicApiKeySchema", () => {
  it("devrait accepter une clé au format Anthropic et retirer les espaces autour", () => {
    expect(AnthropicApiKeySchema.parse(`  ${VALID}\n`)).toBe(VALID);
  });

  it.each([
    ["sans préfixe sk-ant-", `sk-${"a".repeat(40)}`],
    ["vide", "   "],
    ["trop courte", "sk-ant-abc"],
    ["trop longue", `sk-ant-${"a".repeat(300)}`],
    ["avec un espace interne", `sk-ant-api03 ${"a".repeat(40)}`],
    ["avec un caractère interdit", `sk-ant-api03-${"a".repeat(40)}/`],
  ])("devrait refuser une clé %s", (_label, value) => {
    expect(AnthropicApiKeySchema.safeParse(value).success).toBe(false);
  });

  it("ne devrait jamais recopier la valeur dans le message d'erreur", () => {
    const secret = `sk-ant-api03-${"s".repeat(30)}/secret`;
    const result = AnthropicApiKeySchema.safeParse(secret);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("secret");
  });

  it("devrait refuser une valeur qui n'est pas une chaîne", () => {
    expect(AnthropicApiKeySchema.safeParse(42).success).toBe(false);
  });
});

describe("apiKeyLast4", () => {
  it("devrait renvoyer les 4 derniers caractères", () => {
    expect(apiKeyLast4(VALID)).toBe("_-9z");
  });
});
