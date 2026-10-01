import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../logger";
import { createAnthropicClient } from "./anthropic-client";

/**
 * Vérification réelle d'une clé API Anthropic, sans génération ni coût :
 * GET /v1/models?limit=1. Opération idempotente → une nouvelle tentative avec
 * attente sur panne transitoire (réseau, 408/409/429/5xx), jamais sur 401/403.
 * Délai borné par tentative.
 */

export type KeyCheck = { ok: true } | { ok: false; reason: "rejected" | "unavailable" };

export interface VerifyKeyOptions {
  fetch?: typeof fetch;
  /** Délai par tentative (défaut 10 s). */
  timeoutMs?: number;
  /** Attente avant la nouvelle tentative (défaut 500 ms, doublée à chaque essai). */
  retryDelayMs?: number;
  attempts?: number;
}

const log = createLogger({ component: "ai.verify_key" });

function isTransient(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError) return true; // inclut les timeouts
  if (error instanceof Anthropic.APIError) {
    const s = error.status;
    return s === undefined || s === 408 || s === 409 || s === 429 || s >= 500;
  }
  return true; // erreur inattendue du transport : traitée comme indisponibilité
}

export async function verifyAnthropicKey(apiKey: string, options: VerifyKeyOptions = {}): Promise<KeyCheck> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const attempts = Math.max(1, options.attempts ?? 2);
  let delay = options.retryDelayMs ?? 500;
  const client = createAnthropicClient({ apiKey, fetch: options.fetch, maxRetries: 0, timeout: timeoutMs });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.models.list({ limit: 1 }, { signal: AbortSignal.timeout(timeoutMs), maxRetries: 0 });
      return { ok: true };
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        return { ok: false, reason: "rejected" };
      }
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      if (!isTransient(error)) {
        // 4xx inattendue (400, 404…) : pas une clé refusée, pas un problème transitoire.
        log.error("ai.verify_key_unexpected", { status, error });
        return { ok: false, reason: "unavailable" };
      }
      log.warn("ai.verify_key_transient", { attempt, status, errorName: error instanceof Error ? error.name : "unknown" });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
  return { ok: false, reason: "unavailable" };
}
