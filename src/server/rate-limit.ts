import { db } from "./db/client";
import { RateLimitedError } from "./errors";

/**
 * Limitation de débit à fenêtre fixe, partagée entre instances (table
 * usage_window). Une seule requête atomique : INSERT … ON CONFLICT DO UPDATE
 * … WHERE. Si la mise à jour est refusée (quota atteint), aucune ligne n'est
 * renvoyée et rien n'est consommé.
 */

export interface QuotaPolicy {
  limit: number;
  windowSeconds: number;
}

/** Appels IA (génération de deck ou classification) par utilisateur. */
export const AI_QUOTA: QuotaPolicy = {
  limit: Number(process.env.AI_QUOTA_PER_HOUR ?? 80),
  windowSeconds: 3600,
};

export async function consumeQuota(key: string, cost: number, policy: QuotaPolicy): Promise<void> {
  if (!Number.isInteger(cost) || cost < 1 || cost > policy.limit) {
    throw new RateLimitedError(policy.windowSeconds);
  }
  const rows = await db().$queryRaw<{ count: number }[]>`
    INSERT INTO "usage_window" ("key", "windowStart", "count")
    VALUES (${key}, now(), ${cost})
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = CASE
        WHEN "usage_window"."windowStart" <= now() - make_interval(secs => ${policy.windowSeconds})
        THEN now() ELSE "usage_window"."windowStart" END,
      "count" = CASE
        WHEN "usage_window"."windowStart" <= now() - make_interval(secs => ${policy.windowSeconds})
        THEN ${cost} ELSE "usage_window"."count" + ${cost} END
    WHERE "usage_window"."windowStart" <= now() - make_interval(secs => ${policy.windowSeconds})
       OR "usage_window"."count" + ${cost} <= ${policy.limit}
    RETURNING "count"`;
  if (rows.length > 0) return;

  const current = await db().usageWindow.findUnique({ where: { key }, select: { windowStart: true } });
  const elapsed = current ? (Date.now() - current.windowStart.getTime()) / 1000 : 0;
  throw new RateLimitedError(Math.max(1, policy.windowSeconds - elapsed));
}

export function aiQuotaKey(userId: string): string {
  return `ai:${userId}`;
}
