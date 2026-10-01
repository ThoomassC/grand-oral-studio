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

/** Plafond global (toute l'application) : borne le coût IA même en cas d'abus multi-comptes. */
export const AI_GLOBAL_QUOTA: QuotaPolicy = {
  limit: Number(process.env.AI_GLOBAL_HOURLY_LIMIT ?? 600),
  windowSeconds: 3600,
};

export const AI_GLOBAL_QUOTA_KEY = "ai:global";

export async function consumeQuota(
  key: string,
  cost: number,
  policy: QuotaPolicy,
  scope: "user" | "global" = "user",
): Promise<void> {
  if (!Number.isInteger(cost) || cost < 1 || cost > policy.limit) {
    throw new RateLimitedError(policy.windowSeconds, scope);
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
  throw new RateLimitedError(Math.max(1, policy.windowSeconds - elapsed), scope);
}

/** Restitue une consommation (dans la fenêtre courante uniquement). */
async function refundQuota(key: string, cost: number): Promise<void> {
  await db().$executeRaw`
    UPDATE "usage_window" SET "count" = GREATEST("count" - ${cost}, 0)
    WHERE "key" = ${key}`;
}

/**
 * Quota IA : utilisateur PUIS global. Si le plafond global refuse, la
 * consommation de l'utilisateur est restituée (un refus ne coûte rien).
 */
export async function consumeAiQuota(
  userId: string,
  cost: number,
  policies: { user: QuotaPolicy; global: QuotaPolicy } = { user: AI_QUOTA, global: AI_GLOBAL_QUOTA },
): Promise<void> {
  const userKey = aiQuotaKey(userId);
  await consumeQuota(userKey, cost, policies.user, "user");
  try {
    await consumeQuota(AI_GLOBAL_QUOTA_KEY, cost, policies.global, "global");
  } catch (error) {
    await refundQuota(userKey, cost);
    throw error;
  }
}

export function aiQuotaKey(userId: string): string {
  return `ai:${userId}`;
}
