import { z } from "zod";
import type { PromptPair } from "@/domain/contracts";
import {
  normalizeDeckSpec,
  normalizeRawClassification,
  RawClassificationSchema,
  RawDeckSpecSchema,
} from "@/domain/normalize";
import { RawTemplateDraftSchema, type RawTemplateDraft } from "@/domain/import/template-from-text";
import { RawThemePromptDraftSchema, type RawThemePromptDraft } from "@/domain/import/themes-from-text";
import { ClassificationSchema, DeckSpecSchema, type Classification, type DeckSpec } from "@/domain/schemas";
import { AiInvalidOutputError, AiUnavailableError } from "../errors";
import { createSemaphore, SemaphoreTimeoutError, type Semaphore } from "../concurrency";
import { createLogger } from "../logger";
import { deckMaxTokens } from "./anthropic";
import { parseStructured, strict } from "./structured";
import type { AiProvider, DeckHints } from "./types";

/**
 * Fournisseur Ollama (modèle local) — API HTTP d'Ollama :
 *   POST {base}/api/chat  { model, messages, stream: false, format: <JSON schema>, options }
 *   GET  {base}/api/tags  → { models: [{ name, … }] }
 *
 * L'URL de base est fixée par le serveur (OLLAMA_BASE_URL), jamais par
 * l'utilisateur. Même chaîne que pour Claude : JSON.parse → schéma permissif →
 * normalisation → validation stricte. Aucune nouvelle tentative : un modèle
 * local est lent ; budgets distincts pour un deck (AI_OLLAMA_TIMEOUT_MS, 10 min)
 * et une classification (AI_OLLAMA_CLASSIFY_TIMEOUT_MS, 45 s). Concurrence
 * bornée par processus (AI_OLLAMA_MAX_CONCURRENCY, 2), réponse bornée à 2 Mo.
 */

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_CLASSIFY_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_CONCURRENCY = 2;
/** Attente maximale d'une place (au-delà : « le modèle local est occupé »). */
const DEFAULT_QUEUE_WAIT_MS = 20_000;
/** Taille maximale lue d'une réponse Ollama (un deck JSON fait quelques dizaines de Ko). */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TEMPERATURE = 0.4;
const CLASSIFY_MAX_TOKENS = 2_000;
/** Contexte : prompt (gabarit + thèmes) + sortie d'un deck complet. */
const DEFAULT_NUM_CTX = 16_384;

const log = createLogger({ component: "ai.ollama" });

const DECK_SCHEMA = z.toJSONSchema(RawDeckSpecSchema, { io: "input", unrepresentable: "any" });
const CLASSIFY_SCHEMA = z.toJSONSchema(RawClassificationSchema, { io: "input", unrepresentable: "any" });
const TEMPLATE_SCHEMA = z.toJSONSchema(RawTemplateDraftSchema, { io: "input", unrepresentable: "any" });
const THEMES_SCHEMA = z.toJSONSchema(RawThemePromptDraftSchema, { io: "input", unrepresentable: "any" });
/** Brouillon de gabarit : court, mais un modèle local est lent. */
const DRAFT_TIMEOUT_MS = 120_000;
const DRAFT_MAX_TOKENS = 3_000;
const THEMES_MAX_TOKENS = 6_000;

const ChatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  eval_count: z.number().optional(),
  prompt_eval_count: z.number().optional(),
});

const ErrorBodySchema = z.object({ error: z.string() });

const TagsResponseSchema = z.object({
  models: z.array(z.object({ name: z.string().min(1).max(200) })).max(500),
});

function envMs(value: string | undefined, fallback: number): number {
  const n = Number(value?.trim() || Number.NaN);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** Concurrence globale (par processus) des appels Ollama : AI_OLLAMA_MAX_CONCURRENCY, défaut 2. */
const sharedSemaphore = createSemaphore(envMs(process.env.AI_OLLAMA_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENCY));

export class ResponseTooLargeError extends Error {
  constructor() {
    super("réponse trop volumineuse");
    this.name = "ResponseTooLargeError";
  }
}

/** Lit le corps en flux et s'arrête au-delà de `maxBytes` (contrôle préalable de content-length). */
export async function readBoundedText(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
  /** Budget d'une génération de deck (défaut AI_OLLAMA_TIMEOUT_MS, 10 min). */
  timeoutMs?: number;
  /** Budget d'une classification (défaut AI_OLLAMA_CLASSIFY_TIMEOUT_MS, 45 s) : le repli gratuit du jour J ne doit pas attendre. */
  classifyTimeoutMs?: number;
  numCtx?: number;
  /** Concurrence (défaut : sémaphore partagé du processus). */
  semaphore?: Semaphore;
  queueWaitMs?: number;
  /** En production, l'URL interne n'apparaît pas dans les messages. */
  production?: boolean;
}

function notReachable(baseUrl: string, production: boolean, cause: unknown): AiUnavailableError {
  return new AiUnavailableError("ollama: connexion", {
    cause,
    refundable: true,
    userMessage: production
      ? "Le serveur Ollama ne répond pas. Réessayez plus tard ou choisissez un autre moteur dans Paramètres."
      : `Ollama ne répond pas à ${baseUrl} : vérifiez qu'il est lancé (ollama serve).`,
  });
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"));
}

export function createOllamaProvider(options: OllamaProviderOptions): AiProvider {
  const { baseUrl, model } = options;
  const doFetch = options.fetch ?? fetch;
  const deckTimeoutMs = options.timeoutMs ?? envMs(process.env.AI_OLLAMA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const classifyTimeoutMs = options.classifyTimeoutMs ?? envMs(process.env.AI_OLLAMA_CLASSIFY_TIMEOUT_MS, DEFAULT_CLASSIFY_TIMEOUT_MS);
  const numCtx = options.numCtx ?? DEFAULT_NUM_CTX;
  const semaphore = options.semaphore ?? sharedSemaphore;
  const queueWaitMs = options.queueWaitMs ?? DEFAULT_QUEUE_WAIT_MS;
  const production = options.production ?? process.env.NODE_ENV === "production";

  function timedOut(operation: string, timeoutMs: number, cause: unknown): AiUnavailableError {
    return new AiUnavailableError(`${operation}: délai dépassé`, {
      cause,
      userMessage: `Le modèle local n'a pas répondu dans le délai imparti (${Math.max(1, Math.round(timeoutMs / 60_000))} min). Réessayez, ou choisissez un modèle plus léger dans Paramètres.`,
    });
  }

  async function send(operation: string, prompt: PromptPair, format: unknown, maxTokens: number, timeoutMs: number) {
    const started = Date.now();
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          options: { temperature: TEMPERATURE, num_predict: maxTokens, num_ctx: numCtx },
        }),
        signal,
      });
    } catch (error) {
      if (isTimeout(error, signal)) throw timedOut(operation, timeoutMs, error);
      throw notReachable(baseUrl, production, error);
    }

    let text: string;
    try {
      text = await readBoundedText(response);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        throw new AiInvalidOutputError(`${operation}: réponse Ollama trop volumineuse`, { cause: error });
      }
      if (isTimeout(error, signal)) throw timedOut(operation, timeoutMs, error);
      throw new AiUnavailableError(`${operation}: lecture de la réponse interrompue`, { cause: error });
    }

    // Statut d'abord : une erreur HTTP (502 HTML d'un proxy…) est une indisponibilité.
    if (!response.ok) {
      let message = "";
      try {
        message = ErrorBodySchema.safeParse(JSON.parse(text)).data?.error ?? "";
      } catch {
        // corps non JSON : rien à extraire
      }
      if (response.status === 404 || /not found/i.test(message)) {
        throw new AiUnavailableError(`${operation}: modèle absent`, {
          userMessage: `Le modèle ${model} n'est pas installé : ollama pull ${model}`,
        });
      }
      log.error("ollama.http_error", { operation, status: response.status, message: message.slice(0, 200) });
      throw new AiUnavailableError(`${operation}: HTTP ${response.status}`, {
        userMessage: "Ollama a renvoyé une erreur. Réessayez, ou choisissez un autre moteur dans Paramètres.",
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new AiInvalidOutputError(`${operation}: réponse HTTP non JSON`, { cause: error });
    }
    const parsed = ChatResponseSchema.safeParse(body);
    if (!parsed.success) throw new AiInvalidOutputError(`${operation}: réponse Ollama inattendue`, { cause: parsed.error });
    log.info("ai.call", {
      operation,
      engine: "ollama",
      model,
      doneReason: parsed.data.done_reason,
      inputTokens: parsed.data.prompt_eval_count,
      outputTokens: parsed.data.eval_count,
      durationMs: Date.now() - started,
    });
    if (parsed.data.done_reason === "length") throw new AiInvalidOutputError(`${operation}: réponse tronquée (num_predict)`);
    return parsed.data.message.content;
  }

  async function chat(operation: string, prompt: PromptPair, format: unknown, maxTokens: number, timeoutMs: number) {
    try {
      return await semaphore.run(() => send(operation, prompt, format, maxTokens, timeoutMs), queueWaitMs);
    } catch (error) {
      if (error instanceof SemaphoreTimeoutError) {
        log.warn("ollama.busy", { operation, active: semaphore.active, waiting: semaphore.waiting });
        throw new AiUnavailableError(`${operation}: file d'attente pleine`, {
          refundable: true,
          userMessage: "Le modèle local est occupé, réessayez dans un instant.",
        });
      }
      throw error;
    }
  }

  return {
    name: `ollama:${model}`,
    engine: "ollama",

    async generateDeck(prompt: PromptPair, hints?: DeckHints): Promise<DeckSpec> {
      const text = await chat("generateDeck", prompt, DECK_SCHEMA, deckMaxTokens(hints?.template), deckTimeoutMs);
      const raw = parseStructured("generateDeck", text, RawDeckSpecSchema);
      return strict("generateDeck", DeckSpecSchema, normalizeDeckSpec(raw));
    },

    async draftTemplate(prompt: PromptPair): Promise<RawTemplateDraft> {
      const text = await chat("draftTemplate", prompt, TEMPLATE_SCHEMA, DRAFT_MAX_TOKENS, DRAFT_TIMEOUT_MS);
      return parseStructured("draftTemplate", text, RawTemplateDraftSchema);
    },

    async draftThemes(prompt: PromptPair): Promise<RawThemePromptDraft> {
      const text = await chat("draftThemes", prompt, THEMES_SCHEMA, THEMES_MAX_TOKENS, DRAFT_TIMEOUT_MS);
      return parseStructured("draftThemes", text, RawThemePromptDraftSchema);
    },

    async classify(prompt: PromptPair): Promise<Classification> {
      const text = await chat("classify", prompt, CLASSIFY_SCHEMA, CLASSIFY_MAX_TOKENS, classifyTimeoutMs);
      const raw = parseStructured("classify", text, RawClassificationSchema);
      return strict("classify", ClassificationSchema, normalizeRawClassification(raw));
    },
  };
}

export interface OllamaModels {
  reachable: boolean;
  /** Noms triés (ex. « mistral:latest »). */
  models: string[];
}

/** Sonde courte (défaut 1,5 s) : ne lève jamais, renvoie `reachable: false` en cas d'échec. */
export async function listOllamaModels(
  baseUrl: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<OllamaModels> {
  const doFetch = options.fetch ?? fetch;
  try {
    const response = await doFetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(options.timeoutMs ?? 1_500) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { reachable: false, models: [] };
    }
    const parsed = TagsResponseSchema.safeParse(JSON.parse(await readBoundedText(response, 256 * 1024)));
    if (!parsed.success) {
      log.warn("ollama.tags_unexpected", {});
      return { reachable: false, models: [] };
    }
    return { reachable: true, models: [...new Set(parsed.data.models.map((m) => m.name))].sort() };
  } catch {
    return { reachable: false, models: [] };
  }
}
