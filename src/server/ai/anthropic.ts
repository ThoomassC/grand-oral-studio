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
import { AiInvalidOutputError, AiRefusalError, AiUnavailableError } from "../errors";
import { createLogger } from "../logger";
import type { AiProvider, DeckHints } from "./types";

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
 * Deck : streaming (`stream().finalMessage()`), max_tokens dimensionné sur le
 * gabarit, AUCUNE nouvelle tentative (un deck coûte cher et le budget de temps
 * doit rester borné), budget total par AbortSignal.
 * Classification : requête simple, une nouvelle tentative au plus.
 *
 * Repli serveur en cas de refus : betas "server-side-fallback-2026-07-01" +
 * fallbacks "default". Pas de temperature, pas de budget_tokens, pas de prefill.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";

const DEFAULT_DECK_BUDGET_MS = Number(process.env.AI_DECK_TIMEOUT_MS ?? 240_000);
const DEFAULT_CLASSIFY_BUDGET_MS = 90_000;
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

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  /** Injection pour les tests (réponses HTTP rejouées). */
  fetch?: typeof fetch;
  deckBudgetMs?: number;
  classifyBudgetMs?: number;
}

type Operation = "generateDeck" | "classify";

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const model = options.model || DEFAULT_MODEL;
  const deckBudgetMs = options.deckBudgetMs ?? DEFAULT_DECK_BUDGET_MS;
  const classifyBudgetMs = options.classifyBudgetMs ?? DEFAULT_CLASSIFY_BUDGET_MS;
  const client = new Anthropic({ apiKey: options.apiKey, fetch: options.fetch, maxRetries: 0 });

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
      throw mapSdkError(operation, error, signal);
    }
    log.info("ai.call", {
      operation,
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

    async generateDeck(prompt: PromptPair, hints?: DeckHints): Promise<DeckSpec> {
      const params = baseParams(prompt, deckMaxTokens(hints?.template), "medium", DECK_FORMAT);
      const message = await run("generateDeck", deckBudgetMs, (signal) =>
        client.beta.messages.stream(params, { signal, maxRetries: 0, timeout: deckBudgetMs }).finalMessage(),
      );
      const raw = interpret("generateDeck", message, RawDeckSpecSchema);
      return strict("generateDeck", DeckSpecSchema, normalizeDeckSpec(raw));
    },

    async classify(prompt: PromptPair): Promise<Classification> {
      const params = baseParams(prompt, CLASSIFY_MAX_TOKENS, "low", CLASSIFY_FORMAT);
      const message = await run("classify", classifyBudgetMs, (signal) =>
        client.beta.messages.create({ ...params, stream: false }, { signal, maxRetries: 1, timeout: CLASSIFY_ATTEMPT_TIMEOUT_MS }),
      );
      const raw = interpret("classify", message, RawClassificationSchema);
      return strict("classify", ClassificationSchema, normalizeRawClassification(raw));
    },
  };
}

// ---------------------------------------------------------------------------
// Interprétation de la réponse (fonctions pures, exportées pour les tests)
// ---------------------------------------------------------------------------

/** stop_reason d'abord, puis JSON, puis schéma permissif. */
export function interpret<S extends z.ZodType>(operation: Operation, message: BetaMessage, schema: S): z.output<S> {
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
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new AiInvalidOutputError(`${operation}: JSON invalide`, { cause: error });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AiInvalidOutputError(`${operation}: forme JSON inattendue`, { cause: parsed.error });
  }
  return parsed.data;
}

function strict<S extends z.ZodType>(operation: Operation, schema: S, value: unknown): z.output<S> {
  const checked = schema.safeParse(value);
  if (!checked.success) {
    throw new AiInvalidOutputError(`${operation}: sortie hors schéma après normalisation`, { cause: checked.error });
  }
  return checked.data;
}

/**
 * Erreurs du SDK → erreurs typées. Indisponibilité (réseau, 429, 5xx, budget de
 * temps, clé invalide) → AiUnavailableError (503). Une autre 4xx est un bug de
 * notre requête : relancée telle quelle pour être journalisée comme une panne.
 */
function mapSdkError(operation: string, error: unknown, signal: AbortSignal): Error {
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
  return error instanceof Error ? error : new Error(String(error));
}
