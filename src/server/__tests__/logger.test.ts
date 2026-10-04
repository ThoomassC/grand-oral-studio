import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@/server/logger";

afterEach(() => vi.restoreAllMocks());

function capture(fn: () => void): string {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(l));
  vi.spyOn(console, "error").mockImplementation((l: string) => void lines.push(l));
  fn();
  return lines.join("\n");
}

describe("logger — masquage des clés API", () => {
  it.each(["apiKey", "anthropicKey", "anthropic_key", "anthropicKeyCiphertext", "ciphertext", "plaintext"])(
    "devrait masquer le champ %s",
    (field) => {
      const out = capture(() => createLogger().info("evt", { [field]: "valeur-sensible" }));
      expect(out).not.toContain("valeur-sensible");
    },
  );

  it("devrait masquer une clé Anthropic apparaissant dans une valeur libre ou un message d'erreur", () => {
    const key = "sk-ant-api03-AbCdEf0123456789_-xyz";
    const out = capture(() => createLogger().error("evt", { note: `clé ${key}`, error: new Error(`boom ${key}`) }));
    expect(out).not.toContain("AbCdEf0123456789");
    expect(out).toContain("sk-ant-[masqué]");
  });
});
