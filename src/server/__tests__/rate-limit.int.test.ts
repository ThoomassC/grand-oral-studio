import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { RateLimitedError } from "@/server/errors";
import { consumeQuota } from "@/server/rate-limit";
import { setupTestDatabase } from "@/test/db";

setupTestDatabase();

const policy = { limit: 3, windowSeconds: 3600 };

async function countFor(key: string): Promise<number | null> {
  const row = await db().usageWindow.findUnique({ where: { key } });
  return row?.count ?? null;
}

describe("consumeQuota", () => {
  it("devrait accepter exactement `limit` appels concurrents et refuser les suivants", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => consumeQuota("q:concurrence", 1, policy)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected").every((r) => r.reason instanceof RateLimitedError)).toBe(true);
    expect(await countFor("q:concurrence")).toBe(3);
  });

  it("ne devrait rien consommer quand l'appel est refusé", async () => {
    await consumeQuota("q:refus", 3, policy);
    await expect(consumeQuota("q:refus", 1, policy)).rejects.toBeInstanceOf(RateLimitedError);
    expect(await countFor("q:refus")).toBe(3);
  });

  it.each([0, -1, 1.5, 4])("devrait refuser un coût invalide (%s) sans rien écrire", async (cost) => {
    await expect(consumeQuota("q:cout", cost, policy)).rejects.toBeInstanceOf(RateLimitedError);
    expect(await countFor("q:cout")).toBeNull();
  });

  it("devrait rouvrir une fenêtre neuve quand la précédente est expirée", async () => {
    await consumeQuota("q:fenetre", 3, policy);
    await db().$executeRaw`UPDATE "usage_window" SET "windowStart" = now() - interval '2 hours' WHERE "key" = 'q:fenetre'`;
    await consumeQuota("q:fenetre", 1, policy);
    expect(await countFor("q:fenetre")).toBe(1);
  });

  it("devrait isoler les compteurs par clé", async () => {
    await consumeQuota("q:a", 3, policy);
    await expect(consumeQuota("q:b", 1, policy)).resolves.toBeUndefined();
  });

  // BUG (rouge sur une base dont le fuseau de session n'est pas UTC, ex. Europe/Paris) :
  // windowStart est posé par now() en SQL puis relu via Prisma/adapter-pg, qui interprète la
  // valeur dans le mauvais fuseau. Le délai annoncé dépasse alors la fenêtre (3600 s + décalage).
  // src/server/rate-limit.ts:41-43 ; cause racine : src/server/db/client.ts:17-25 (fuseau non fixé).
  it("devrait annoncer un délai d'attente au plus égal à la fenêtre quand le quota est épuisé", async () => {
    await consumeQuota("q:delai", 3, policy);
    const error = await consumeQuota("q:delai", 1, policy).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeGreaterThan(0);
    expect((error as RateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(policy.windowSeconds);
  });
});
