import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../logger";
import type { CloudProvider } from "@/domain/ai-providers";
import { createAnthropicClient } from "./anthropic-client";
import { PROVIDER_CATALOG } from "./catalog";
import { readBoundedText } from "./http";
import type { OpenAiCompatibleId } from "./openai-compatible";

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

// ---------------------------------------------------------------------------
// Fournisseurs OpenAI-compatibles (Mistral, Gemini, OpenAI)
// ---------------------------------------------------------------------------

/**
 * Vérification d'une clé Mistral, Gemini ou OpenAI sans génération ni coût :
 * GET {baseUrl}/models (URL FIXE du catalogue). 401/403 — et le 400 « API key
 * not valid » de Google — : clé refusée, sans nouvelle tentative ; réseau,
 * 408/409/429/5xx : nouvelle tentative avec attente ; autre 4xx : indisponible,
 * journalisé. Délai borné par tentative.
 */
export async function verifyOpenAiCompatibleKey(
  provider: OpenAiCompatibleId,
  apiKey: string,
  options: VerifyKeyOptions = {},
): Promise<KeyCheck> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const attempts = Math.max(1, options.attempts ?? 2);
  let delay = options.retryDelayMs ?? 500;
  const doFetch = options.fetch ?? fetch;
  const url = `${PROVIDER_CATALOG[provider].baseUrl}/models`;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let status: number | undefined;
    try {
      const response = await doFetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      const text = await readBoundedText(response, 512 * 1024).catch(() => "");
      if (response.ok) return { ok: true };
      if (status === 401 || status === 403 || (status === 400 && /api[_ ]?key/i.test(text))) return { ok: false, reason: "rejected" };
      if (!(status === 408 || status === 409 || status === 429 || status >= 500)) {
        log.error("ai.verify_key_unexpected", { provider, status });
        return { ok: false, reason: "unavailable" };
      }
    } catch (error) {
      // Réseau ou délai dépassé : transitoire.
      log.warn("ai.verify_key_transient", { provider, attempt, errorName: error instanceof Error ? error.name : "unknown" });
    }
    if (status !== undefined) log.warn("ai.verify_key_transient", { provider, attempt, status });
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  return { ok: false, reason: "unavailable" };
}

/** Vérification de la clé d'un fournisseur cloud, quel qu'il soit. */
export function verifyProviderKey(provider: CloudProvider, apiKey: string, options: VerifyKeyOptions = {}): Promise<KeyCheck> {
  return provider === "claude" ? verifyAnthropicKey(apiKey, options) : verifyOpenAiCompatibleKey(provider, apiKey, options);
}
