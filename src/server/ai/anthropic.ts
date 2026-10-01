import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { PromptPair } from "@/domain/contracts";
import { ClassificationSchema, DeckSpecSchema, type Classification, type DeckSpec } from "@/domain/schemas";
import { AiInvalidOutputError, AiRefusalError, AiUnavailableError } from "../errors";
import { createLogger } from "../logger";
import type { AiProvider } from "./types";

/**
 * Fournisseur Anthropic.
 *
 * - Sortie structurée : `client.beta.messages.parse` + `betaZodOutputFormat`
 *   (le helper importe `zod/v4`, compatible avec le zod 4 du projet).
 *   L'API beta est nécessaire pour combiner parse et repli serveur.
 * - Repli serveur en cas de refus : `betas: ["server-side-fallback-2026-07-01"]`
 *   + `fallbacks: "default"` (typé par le SDK 0.131 sur l'API beta).
 * - Pas de temperature, pas de budget_tokens, pas de prefill ; profondeur de
 *   réflexion pilotée par `output_config.effort`.
 * - Timeouts par appel ; retries SDK (429/5xx/réseau) avec backoff : l'appel
 *   est sans effet de bord côté serveur, donc rejouable.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";

const DECK_TIMEOUT_MS = 240_000;
const CLASSIFY_TIMEOUT_MS = 60_000;
const DECK_MAX_TOKENS = 16_000;
const CLASSIFY_MAX_TOKENS = 4_000;

const log = createLogger({ component: "ai.anthropic" });

export function createAnthropicProvider(options: { apiKey: string; model?: string }): AiProvider {
  const model = options.model || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 2, timeout: DECK_TIMEOUT_MS });

  async function call<S extends z.ZodType>(
    operation: "generateDeck" | "classify",
    prompt: PromptPair,
    schema: S,
    opts: { effort: "low" | "medium"; maxTokens: number; timeoutMs: number },
  ): Promise<z.output<S>> {
    const started = Date.now();
    let message;
    try {
      message = await client.beta.messages.parse(
        {
          model,
          max_tokens: opts.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          output_config: { effort: opts.effort, format: betaZodOutputFormat(schema) },
        },
        { timeout: opts.timeoutMs },
      );
    } catch (error) {
      throw mapSdkError(operation, error);
    }

    log.info("ai.call", {
      operation,
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      durationMs: Date.now() - started,
    });

    if (message.stop_reason === "refusal") {
      throw new AiRefusalError(message.stop_details?.category ?? null);
    }
    if (message.stop_reason === "max_tokens") {
      throw new AiInvalidOutputError(`${operation}: réponse tronquée (max_tokens)`);
    }
    if (message.parsed_output === null || message.parsed_output === undefined) {
      throw new AiInvalidOutputError(`${operation}: parsed_output absent (stop_reason=${message.stop_reason})`);
    }
    // Revalidation au bord : on ne fait pas confiance au helper pour les transformations.
    const checked = schema.safeParse(message.parsed_output);
    if (!checked.success) {
      throw new AiInvalidOutputError(`${operation}: sortie hors schéma`, { cause: checked.error });
    }
    return checked.data;
  }

  return {
    name: `anthropic:${model}`,
    generateDeck(prompt: PromptPair): Promise<DeckSpec> {
      return call("generateDeck", prompt, DeckSpecSchema, {
        effort: "medium",
        maxTokens: DECK_MAX_TOKENS,
        timeoutMs: DECK_TIMEOUT_MS,
      });
    },
    classify(prompt: PromptPair): Promise<Classification> {
      return call("classify", prompt, ClassificationSchema, {
        effort: "low",
        maxTokens: CLASSIFY_MAX_TOKENS,
        timeoutMs: CLASSIFY_TIMEOUT_MS,
      });
    },
  };
}

/**
 * Erreurs du SDK → erreurs typées. Indisponibilité (réseau, 429, 5xx, timeout,
 * clé invalide) → AiUnavailableError (503). Une 400 est un bug de notre requête :
 * on la relance telle quelle pour qu'elle soit journalisée comme une panne.
 * Une erreur de parsing (JSON/zod levée par le helper) → AiInvalidOutputError.
 */
function mapSdkError(operation: string, error: unknown): Error {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiUnavailableError(`${operation}: timeout`, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiUnavailableError(`${operation}: connexion`, { cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    log.error("ai.config_error", { operation, status: error.status });
    return new AiUnavailableError(`${operation}: authentification refusée (${error.status})`, { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    return new AiUnavailableError(`${operation}: ${error.status}`, { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    if (typeof error.status === "number" && error.status >= 500) {
      return new AiUnavailableError(`${operation}: ${error.status}`, { cause: error });
    }
    return error;
  }
  if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
    return new AiInvalidOutputError(`${operation}: JSON invalide`, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}
