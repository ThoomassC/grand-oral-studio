import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage, MessageCreateParamsBase } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import type { PromptPair } from "@/domain/contracts";
import {
  normalizeDeckSpec,
  normalizeRawClassification,
  RawClassificationSchema,
  RawDeckSpecSchema,
} from "@/domain/normalize";
import { ClassificationSchema, DeckSpecSchema, type Classification, type DeckSpec, type PromptTemplate } from "@/domain/schemas";
import { totalSlides } from "@/domain/slides";
import {
  AiCreditExhaustedError,
  AiInvalidOutputError,
  AiKeyRejectedError,
  AiProviderRateLimitedError,
  AiRefusalError,
  AiUnavailableError,
} from "../errors";
import { createLogger } from "../logger";
import { createAnthropicClient } from "./anthropic-client";
import { DEFAULT_MODEL } from "./model";
import { retryAfterSeconds } from "./retry-after";
import { parseJson, parseStructured, strict } from "./structured";
import { STRUCTURED_TASKS } from "./tasks";
import type { AiProvider, CallOptions, DeckHints, StructuredRequest, StructuredResult, StructuredTask } from "./types";

/**
 * Fournisseur Anthropic.
 *
 * Sortie structurée : on envoie au modèle un schéma PERMISSIF (forme seule, sans
 * bornes de longueur — cf. src/domain/normalize.ts) et on interprète la réponse
 * nous-mêmes, dans cet ordre :
 *   1. stop_reason : refus → AiRefusalError ; max_tokens → AiInvalidOutputError ;
 *   2. JSON.parse puis schéma permissif → AiInvalidOutputError si échec ;
 *   3. normalisation dans les bornes du domaine, puis validation stricte.
 * Le format est passé sans sa fonction `parse` : le SDK ne tente donc aucun
 * parsing lui-même (il lèverait une AnthropicError générique avant qu'on ait pu
 * lire stop_reason).
 *
 * Deck : streaming (`stream().finalMessage()`), max_tokens dimensionné sur la
 * trame, AUCUNE nouvelle tentative (un deck coûte cher et le budget de temps
 * doit rester borné), budget total par AbortSignal.
 * Classification : requête simple, une nouvelle tentative au plus.
 * Tâches structurées (questions du jury, une diapo) : requête simple, aucune
 * nouvelle tentative. `CallOptions.budgetMs` remplace le budget par défaut.
 *
 * Repli serveur en cas de refus : betas "server-side-fallback-2026-07-01" +
 * fallbacks "default". Pas de temperature, pas de budget_tokens, pas de prefill.
 */

export { DEFAULT_MODEL };

const DEFAULT_DECK_BUDGET_MS = Number(process.env.AI_DECK_TIMEOUT_MS ?? 240_000);
const DEFAULT_CLASSIFY_BUDGET_MS = 90_000;
const DEFAULT_STRUCTURED_BUDGET_MS = 120_000;
const CLASSIFY_ATTEMPT_TIMEOUT_MS = 45_000;
const CLASSIFY_MAX_TOKENS = 4_000;

/** Réflexion adaptative (toujours active sur ce modèle) + texte ≈ 900 jetons par diapo. */
const DECK_BASE_TOKENS = 8_000;
const DECK_TOKENS_PER_SLIDE = 900;
const DECK_MAX_TOKENS_CAP = 64_000;

export function deckMaxTokens(template: PromptTemplate | undefined): number {
  const slides = template ? totalSlides(template) : 20;
  return Math.min(DECK_MAX_TOKENS_CAP, DECK_BASE_TOKENS + slides * DECK_TOKENS_PER_SLIDE);
}

const log = createLogger({ component: "ai.anthropic" });

/** Format JSON pour l'API, sans la fonction `parse` du helper. */
function jsonFormat(schema: z.ZodType) {
  const { type, schema: jsonSchema } = betaZodOutputFormat(schema);
  return { type, schema: jsonSchema };
}

const DECK_FORMAT = jsonFormat(RawDeckSpecSchema);
const CLASSIFY_FORMAT = jsonFormat(RawClassificationSchema);
const TASK_FORMATS = {
  juryQuestions: jsonFormat(STRUCTURED_TASKS.juryQuestions.raw),
  slide: jsonFormat(STRUCTURED_TASKS.slide.raw),
} as const;

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /** Injection pour les tests (réponses HTTP rejouées). */
  fetch?: typeof fetch;
  deckBudgetMs?: number;
  classifyBudgetMs?: number;
  structuredBudgetMs?: number;
  /**
   * Propriétaire de la clé. "user" : une 401/403 est une erreur ATTENDUE
   * (AiKeyRejectedError, à corriger dans la Configuration IA) ; "server" (défaut) : c'est
   * une panne de configuration (AiUnavailableError, journalisée).
   */
  keySource?: "user" | "server";
}

type Operation = "generateDeck" | "classify" | StructuredTask;

const budget = (options: CallOptions | undefined, fallback: number) =>
  options?.budgetMs !== undefined && options.budgetMs > 0 ? options.budgetMs : fallback;

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const model = options.model || DEFAULT_MODEL;
  const deckBudgetMs = options.deckBudgetMs ?? DEFAULT_DECK_BUDGET_MS;
  const classifyBudgetMs = options.classifyBudgetMs ?? DEFAULT_CLASSIFY_BUDGET_MS;
  const structuredBudgetMs = options.structuredBudgetMs ?? DEFAULT_STRUCTURED_BUDGET_MS;
  const keySource = options.keySource ?? "server";
  const client = createAnthropicClient({ apiKey: options.apiKey, fetch: options.fetch, maxRetries: 0 });

  function baseParams(prompt: PromptPair, maxTokens: number, effort: "low" | "medium", format: ReturnType<typeof jsonFormat>) {
    return {
      model,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      output_config: { effort, format },
    } satisfies MessageCreateParamsBase;
  }

  async function run(operation: Operation, budgetMs: number, send: (signal: AbortSignal) => Promise<BetaMessage>) {
    const started = Date.now();
    const signal = AbortSignal.timeout(budgetMs);
    let message: BetaMessage;
    try {
      message = await send(signal);
    } catch (error) {
      throw mapSdkError(operation, error, signal, keySource);
    }
    log.info("ai.call", {
      operation,
      keySource,
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      durationMs: Date.now() - started,
    });
    return message;
  }

  return {
    name: `anthropic:${model}`,
    engine: "claude",

    async generateDeck(prompt: PromptPair, hints?: DeckHints, options?: CallOptions): Promise<DeckSpec> {
      const params = baseParams(prompt, deckMaxTokens(hints?.template), "medium", DECK_FORMAT);
      const budgetMs = budget(options, deckBudgetMs);
      const message = await run("generateDeck", budgetMs, (signal) =>
        client.beta.messages.stream(params, { signal, maxRetries: 0, timeout: budgetMs }).finalMessage(),
      );
      const raw = interpret("generateDeck", message, RawDeckSpecSchema);
      return strict("generateDeck", DeckSpecSchema, normalizeDeckSpec(raw));
    },

    async classify(prompt: PromptPair, _hints?: unknown, options?: CallOptions): Promise<Classification> {
      const params = baseParams(prompt, CLASSIFY_MAX_TOKENS, "low", CLASSIFY_FORMAT);
      const message = await run("classify", budget(options, classifyBudgetMs), (signal) =>
        client.beta.messages.create({ ...params, stream: false }, { signal, maxRetries: 1, timeout: CLASSIFY_ATTEMPT_TIMEOUT_MS }),
      );
      const raw = interpret("classify", message, RawClassificationSchema);
      return strict("classify", ClassificationSchema, normalizeRawClassification(raw));
    },

    async generateStructured<R extends StructuredRequest>(req: R, options?: CallOptions): Promise<StructuredResult<R>> {
      const spec = STRUCTURED_TASKS[req.task];
      const params = baseParams(req.prompt, spec.maxTokens, "medium", TASK_FORMATS[req.task]);
      const budgetMs = budget(options, structuredBudgetMs);
      const message = await run(req.task, budgetMs, (signal) =>
        client.beta.messages.create({ ...params, stream: false }, { signal, maxRetries: 0, timeout: budgetMs }),
      );
      return spec.finish(parseJson(req.task, messageText(req.task, message))) as StructuredResult<R>;
    },
  };
}

// ---------------------------------------------------------------------------
// Interprétation de la réponse (fonctions pures, exportées pour les tests)
// ---------------------------------------------------------------------------

/** stop_reason d'abord, puis le texte (lève si vide). */
function messageText(operation: Operation, message: BetaMessage): string {
  if (message.stop_reason === "refusal") {
    throw new AiRefusalError(message.stop_details?.category ?? null);
  }
  if (message.stop_reason === "max_tokens") {
    throw new AiInvalidOutputError(`${operation}: réponse tronquée (max_tokens)`);
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  if (!text) {
    throw new AiInvalidOutputError(`${operation}: réponse sans texte (stop_reason=${message.stop_reason})`);
  }
  return text;
}

/** stop_reason d'abord, puis JSON, puis schéma permissif. */
export function interpret<S extends z.ZodType>(operation: Operation, message: BetaMessage, schema: S): z.output<S> {
  return parseStructured(operation, messageText(operation, message), schema);
}

/**
 * Erreurs du SDK → erreurs typées. Indisponibilité (réseau, 5xx, budget de
 * temps, clé SERVEUR invalide) → AiUnavailableError (503) ; limite de débit
 * (429) → AiProviderRateLimitedError (Retry-After, remboursable) ; clé
 * UTILISATEUR refusée → AiKeyRejectedError. Une autre 4xx est un bug de
 * notre requête : relancée telle quelle pour être journalisée comme une panne.
 */
function mapSdkError(operation: string, error: unknown, signal: AbortSignal, keySource: "user" | "server"): Error {
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) {
    return new AiUnavailableError(`${operation}: budget de temps dépassé`, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiUnavailableError(`${operation}: timeout`, { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiUnavailableError(`${operation}: connexion`, { cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    if (keySource === "user") {
      log.warn("ai.user_key_rejected", { operation, status: error.status });
      return new AiKeyRejectedError({ cause: error });
    }
    log.error("ai.config_error", { operation, status: error.status });
    return new AiUnavailableError(`${operation}: authentification refusée (${error.status})`, { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    // Comme les autres fournisseurs : rien n'a été calculé (unité restituée), attente annoncée.
    const seconds = retryAfterSeconds(error.headers?.get("retry-after") ?? null);
    log.warn("ai.provider_rate_limited", { operation, provider: "claude", keySource, status: error.status, retryAfterSeconds: seconds });
    return new AiProviderRateLimitedError("claude", seconds, { cause: error });
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new AiUnavailableError(`${operation}: ${error.status}`, { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) {
    if (keySource === "user") {
      log.warn("ai.user_credit_exhausted", { operation });
      return new AiCreditExhaustedError({ cause: error });
    }
    log.error("ai.server_credit_exhausted", { operation });
    return new AiUnavailableError(`${operation}: crédit du compte serveur épuisé`, { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    if (typeof error.status === "number" && error.status >= 500) {
      return new AiUnavailableError(`${operation}: ${error.status}`, { cause: error });
    }
    return error;
  }
  return error instanceof Error ? error : new Error(String(error));
}
