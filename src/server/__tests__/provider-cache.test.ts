import { describe, expect, it } from "vitest";
import { createProviderCache } from "@/server/ai/provider-cache";
import type { AiProvider } from "@/server/ai/types";

function fakeProvider(name: string): AiProvider {
  return { name, generateDeck: async () => Promise.reject(new Error("x")), classify: async () => Promise.reject(new Error("x")) };
}

describe("createProviderCache", () => {
  it("devrait réutiliser le client d'une même clé et en créer un distinct par clé", () => {
    const cache = createProviderCache(4);
    let built = 0;
    const make = (n: string) => () => {
      built += 1;
      return fakeProvider(n);
    };
    const a1 = cache.get({ apiKey: "sk-ant-a", model: "m", source: "user" }, make("a"));
    const a2 = cache.get({ apiKey: "sk-ant-a", model: "m", source: "user" }, make("a"));
    const b = cache.get({ apiKey: "sk-ant-b", model: "m", source: "user" }, make("b"));
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
    expect(built).toBe(2);
  });

  it("devrait distinguer le modèle et la source pour une même clé", () => {
    const cache = createProviderCache(4);
    const x = cache.get({ apiKey: "k", model: "m1", source: "user" }, () => fakeProvider("1"));
    const y = cache.get({ apiKey: "k", model: "m2", source: "user" }, () => fakeProvider("2"));
    const z = cache.get({ apiKey: "k", model: "m1", source: "server" }, () => fakeProvider("3"));
    expect(new Set([x, y, z]).size).toBe(3);
  });

  it("devrait rester borné (éviction du moins récemment utilisé)", () => {
    const cache = createProviderCache(2);
    const first = cache.get({ apiKey: "1", model: "m", source: "user" }, () => fakeProvider("1"));
    cache.get({ apiKey: "2", model: "m", source: "user" }, () => fakeProvider("2"));
    cache.get({ apiKey: "1", model: "m", source: "user" }, () => fakeProvider("1bis")); // 1 redevient récent
    cache.get({ apiKey: "3", model: "m", source: "user" }, () => fakeProvider("3")); // évince 2
    expect(cache.size).toBe(2);
    expect(cache.get({ apiKey: "1", model: "m", source: "user" }, () => fakeProvider("nouveau"))).toBe(first);
    expect(cache.get({ apiKey: "2", model: "m", source: "user" }, () => fakeProvider("2bis")).name).toBe("2bis");
  });

  it("ne devrait pas conserver la clé en clair comme index du cache", () => {
    const cache = createProviderCache(2);
    cache.get({ apiKey: "sk-ant-secret-key", model: "m", source: "user" }, () => fakeProvider("s"));
    expect(cache.keys().join(" ")).not.toContain("sk-ant-secret-key");
  });
});
