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

/**
 * Entier positif lu dans l'environnement ; une valeur vide ou invalide prend le
 * défaut (un `AI_QUOTA_PER_HOUR=` vide recopié de .env.example ne doit pas
 * donner un quota de 0).
 */
export function envPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value?.trim() || Number.NaN);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** Appels IA (génération de deck ou classification) par utilisateur, sur la clé du serveur. */
export const AI_QUOTA: QuotaPolicy = {
  limit: envPositiveInt(process.env.AI_QUOTA_PER_HOUR, 80),
  windowSeconds: 3600,
};

/**
 * Appels IA par utilisateur sur SA PROPRE clé : le budget du serveur n'est pas
 * en jeu (pas de plafond global), mais on protège encore contre les boucles.
 */
export const AI_QUOTA_OWN_KEY: QuotaPolicy = {
  limit: envPositiveInt(process.env.AI_QUOTA_PER_HOUR_OWN_KEY, 200),
  windowSeconds: 3600,
};

/** Plafond global (toute l'application) : borne le coût IA même en cas d'abus multi-comptes. */
export const AI_GLOBAL_QUOTA: QuotaPolicy = {
  limit: envPositiveInt(process.env.AI_GLOBAL_HOURLY_LIMIT, 600),
  windowSeconds: 3600,
};

/**
 * Vérifications de clé API (enregistrement, test) par utilisateur : sans cette
 * limite, le serveur servirait d'oracle pour tester des clés volées en masse.
 */
export const API_KEY_VERIFY_QUOTA: QuotaPolicy = { limit: 10, windowSeconds: 3600 };

export const AI_GLOBAL_QUOTA_KEY = "ai:global";

export async function consumeQuota(
  key: string,
  cost: number,
  policy: QuotaPolicy,
  scope: RateLimitedError["scope"] = "user",
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
  await consumeUserThenGlobal(
    { key: aiQuotaKey(userId), policy: policies.user },
    { key: AI_GLOBAL_QUOTA_KEY, policy: policies.global },
    cost,
  );
}

/**
 * Compteur utilisateur PUIS compteur global ; si le global refuse, la
 * consommation de l'utilisateur est restituée (un refus ne coûte rien).
 */
async function consumeUserThenGlobal(
  user: { key: string; policy: QuotaPolicy; scope?: RateLimitedError["scope"] },
  global: { key: string; policy: QuotaPolicy; scope?: RateLimitedError["scope"] },
  cost: number,
): Promise<void> {
  await consumeQuota(user.key, cost, user.policy, user.scope ?? "user");
  try {
    await consumeQuota(global.key, cost, global.policy, global.scope ?? "global");
  } catch (error) {
    await refundQuota(user.key, cost);
    throw error;
  }
}

export function aiQuotaKey(userId: string): string {
  return `ai:${userId}`;
}

/** Compteur distinct : l'usage sur sa propre clé n'entame pas le quota financé par le serveur. */
export function aiOwnKeyQuotaKey(userId: string): string {
  return `ai-own:${userId}`;
}

/** Quota IA sur la clé de l'utilisateur : par utilisateur uniquement, pas de plafond global. */
export async function consumeOwnKeyAiQuota(userId: string, cost: number, policy: QuotaPolicy = AI_QUOTA_OWN_KEY): Promise<void> {
  await consumeQuota(aiOwnKeyQuotaKey(userId), cost, policy, "user");
}

/**
 * Qui paie l'appel IA : l'utilisateur (sa clé), le serveur (clé serveur ou
 * mock), ou la machine locale (Ollama : pas de coût d'API, mais du calcul).
 */
export type AiBilling = "user" | "server" | "local";

/** Ollama : quota par utilisateur (protège la machine), pas de plafond global d'API. */
export const AI_QUOTA_LOCAL: QuotaPolicy = {
  limit: envPositiveInt(process.env.AI_QUOTA_PER_HOUR_OLLAMA, 80),
  windowSeconds: 3600,
};

export function aiLocalQuotaKey(userId: string): string {
  return `ai-local:${userId}`;
}

/** Plafond global Ollama : une seule machine sert tous les utilisateurs. */
export const AI_LOCAL_GLOBAL_QUOTA: QuotaPolicy = {
  limit: envPositiveInt(process.env.AI_OLLAMA_GLOBAL_HOURLY_LIMIT, 200),
  windowSeconds: 3600,
};
export const AI_LOCAL_GLOBAL_QUOTA_KEY = "ai-local:global";

export async function consumeAiQuotaFor(billing: AiBilling, userId: string, cost: number): Promise<void> {
  if (billing === "user") await consumeOwnKeyAiQuota(userId, cost);
  else if (billing === "local") {
    await consumeUserThenGlobal(
      { key: aiLocalQuotaKey(userId), policy: AI_QUOTA_LOCAL },
      { key: AI_LOCAL_GLOBAL_QUOTA_KEY, policy: AI_LOCAL_GLOBAL_QUOTA },
      cost,
    );
  } else await consumeAiQuota(userId, cost);
}

/**
 * Restitue une consommation IA quand rien n'a été calculé (connexion refusée,
 * file d'attente pleine). Compteurs de la fenêtre courante uniquement, jamais
 * en dessous de 0.
 */
export async function refundAiQuotaFor(billing: AiBilling, userId: string, cost: number): Promise<void> {
  if (billing === "user") await refundQuota(aiOwnKeyQuotaKey(userId), cost);
  else if (billing === "local") {
    await refundQuota(aiLocalQuotaKey(userId), cost);
    await refundQuota(AI_LOCAL_GLOBAL_QUOTA_KEY, cost);
  } else {
    await refundQuota(aiQuotaKey(userId), cost);
    await refundQuota(AI_GLOBAL_QUOTA_KEY, cost);
  }
}

/**
 * Moteur gratuit (sans IA, instantané) : aucun quota IA, seulement une limite
 * anti-abus large (une génération gratuite coûte quelques lectures/écritures).
 */
export const FREE_ENGINE_QUOTA: QuotaPolicy = { limit: 600, windowSeconds: 3600 };

export function freeQuotaKey(userId: string): string {
  return `free:${userId}`;
}

export async function consumeFreeEngineQuota(userId: string, policy: QuotaPolicy = FREE_ENGINE_QUOTA): Promise<void> {
  await consumeQuota(freeQuotaKey(userId), 1, policy, "user");
}

/** Plafond global des vérifications de clé (toute l'application). */
export const API_KEY_VERIFY_GLOBAL_QUOTA: QuotaPolicy = { limit: 200, windowSeconds: 3600 };
export const API_KEY_VERIFY_GLOBAL_KEY = "apikey-verify:global";

export async function consumeApiKeyVerifyQuota(userId: string, policy: QuotaPolicy = API_KEY_VERIFY_QUOTA): Promise<void> {
  await consumeUserThenGlobal(
    { key: `apikey-verify:${userId}`, policy, scope: "verify" },
    { key: API_KEY_VERIFY_GLOBAL_KEY, policy: API_KEY_VERIFY_GLOBAL_QUOTA, scope: "verify" },
    1,
  );
}

/**
 * Imports (charte depuis un fichier, gabarit depuis un texte) par utilisateur :
 * la lecture d'une archive Office coûte du calcul (décompression bornée). Les
 * imports par IA consomment EN PLUS le quota IA, comme une génération.
 */
export const IMPORT_QUOTA: QuotaPolicy = { limit: 60, windowSeconds: 3600 };

export function importQuotaKey(userId: string): string {
  return `import:${userId}`;
}

export async function consumeImportQuota(userId: string, policy: QuotaPolicy = IMPORT_QUOTA): Promise<void> {
  await consumeQuota(importQuotaKey(userId), 1, policy, "import");
}
