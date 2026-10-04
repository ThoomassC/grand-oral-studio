import { describe, expect, it } from "vitest";
import { configuredModel, resolveAiSource } from "@/server/ai/resolve";
import { AiUnavailableError } from "@/server/errors";

const dev = { NODE_ENV: "development" } as const;
const prod = { NODE_ENV: "production" } as const;

describe("resolveAiSource — ordre clé utilisateur > clé serveur > mock (dev) > aucune", () => {
  it("devrait préférer la clé de l'utilisateur à la clé serveur", () => {
    expect(resolveAiSource({ hasUserKey: true, env: { ...prod, ANTHROPIC_API_KEY: "sk-ant-server" } })).toBe("user");
  });

  it("devrait préférer la clé de l'utilisateur même quand AI_PROVIDER=mock", () => {
    expect(resolveAiSource({ hasUserKey: true, env: { ...dev, AI_PROVIDER: "mock" } })).toBe("user");
  });

  it("devrait utiliser la clé serveur quand l'utilisateur n'en a pas", () => {
    expect(resolveAiSource({ hasUserKey: false, env: { ...prod, ANTHROPIC_API_KEY: "sk-ant-server" } })).toBe("server");
  });

  it("devrait ignorer une clé serveur composée d'espaces", () => {
    expect(resolveAiSource({ hasUserKey: false, env: { ...prod, ANTHROPIC_API_KEY: "   " } })).toBe("none");
  });

  it("devrait utiliser le mock quand AI_PROVIDER=mock, même avec une clé serveur", () => {
    expect(resolveAiSource({ hasUserKey: false, env: { ...dev, AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "sk-ant-x" } })).toBe(
      "mock",
    );
  });

  it("ne devrait plus retomber sur le mock sans AI_PROVIDER=mock, même hors production (le moteur gratuit prend le relais)", () => {
    expect(resolveAiSource({ hasUserKey: false, env: dev })).toBe("none");
    expect(resolveAiSource({ hasUserKey: false, env: { NODE_ENV: "test" } })).toBe("none");
  });

  it("ne devrait jamais retomber sur le mock en production sans clé", () => {
    expect(resolveAiSource({ hasUserKey: false, env: prod })).toBe("none");
  });

  it("ne devrait pas retomber sur le mock quand AI_PROVIDER=anthropic est imposé sans clé", () => {
    expect(resolveAiSource({ hasUserKey: false, env: { ...dev, AI_PROVIDER: "anthropic" } })).toBe("none");
  });

  it("devrait lever une erreur de configuration pour un AI_PROVIDER inconnu", () => {
    expect(() => resolveAiSource({ hasUserKey: false, env: { ...dev, AI_PROVIDER: "openai" } })).toThrow(AiUnavailableError);
  });
});

describe("configuredModel", () => {
  it("devrait prendre AI_MODEL, sinon le modèle par défaut", () => {
    expect(configuredModel({ AI_MODEL: " claude-x " })).toBe("claude-x");
    expect(configuredModel({})).toBe("claude-opus-5-5");
  });
});
