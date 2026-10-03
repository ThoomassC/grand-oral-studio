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
import { ClassificationSchema, DeckSpecSchema, type Classification, type DeckSpec, type PromptTemplate } from "@/domain/schemas";
import { totalSlides } from "@/domain/slides";
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
/** Plafond pour un gros deck (contexte natif des modèles 14B courants : qwen2.5, llama3.1). */
const MAX_DECK_NUM_CTX = 32_768;
/** Estimations prudentes : ~3 caractères par jeton (français + JSON), ~400 jetons de sortie par diapo avec notes rédigées. */
const CHARS_PER_TOKEN = 3;
const OUTPUT_TOKENS_PER_SLIDE = 400;

/** Longueurs successives des notes du squelette transmises quand le prompt déborde (0 = omises). */
const SKELETON_NOTES_STEPS = [300, 120, 0] as const;

export interface DeckContext {
  /** num_ctx à demander : besoin estimé arrondi au Ki, entre le défaut et le plafond. */
  numCtx: number;
  /** Besoin estimé (prompt + sortie + marge), en jetons. */
  neededTokens: number;
  /** false : Ollama tronquerait le DÉBUT du prompt (les règles du system) sans le dire. */
  fits: boolean;
}

/**
 * Contexte d'une génération de deck : prompt + sortie attendue. Sans
 * agrandissement, un deck de 31 diapos dont le prompt transmet les notes du
 * squelette dépasse 16 k ; au-delà du plafond, `fits` est faux.
 */
export function deckContext(prompt: PromptPair, template: PromptTemplate | undefined, max: number = MAX_DECK_NUM_CTX): DeckContext {
  const promptTokens = Math.ceil((prompt.system.length + prompt.user.length) / CHARS_PER_TOKEN);
  const outputTokens = (template ? totalSlides(template) : 20) * OUTPUT_TOKENS_PER_SLIDE;
  const neededTokens = promptTokens + outputTokens + 512;
  const rounded = Math.ceil(neededTokens / 1024) * 1024;
  return { numCtx: Math.min(max, Math.max(Math.min(DEFAULT_NUM_CTX, max), rounded)), neededTokens, fits: neededTokens <= max };
}

export function deckNumCtx(prompt: PromptPair, template: PromptTemplate | undefined): number {
  return deckContext(prompt, template).numCtx;
}

const log = createLogger({ component: "ai.ollama" });

/**
 * Prompt de deck ajusté au plafond de contexte : s'il déborde, les notes du
 * squelette (le moins important : l'IA les réécrit de toute façon) sont
 * raccourcies par paliers, puis omises. Journalise sans aucune donnée
 * utilisateur (tailles seulement).
 */
function fitDeckPrompt(prompt: PromptPair, hints: DeckHints | undefined, max: number = MAX_DECK_NUM_CTX) {
  const initial = deckContext(prompt, hints?.template, max);
  if (initial.fits) return { prompt, context: initial };
  if (hints?.compactPrompt) {
    for (const skeletonNotesMax of SKELETON_NOTES_STEPS) {
      const candidate = hints.compactPrompt(skeletonNotesMax);
      const context = deckContext(candidate, hints.template, max);
      if (context.fits) {
        log.warn("ollama.context_reduced", { neededTokens: initial.neededTokens, maxCtx: max, skeletonNotesMax, reducedTokens: context.neededTokens });
        return { prompt: candidate, context };
      }
    }
  }
  // Rien à réduire (ou pas assez) : Ollama tronquera le début du prompt, le deck sera probablement hors gabarit.
  const last = hints?.compactPrompt?.(0) ?? prompt;
  const context = deckContext(last, hints?.template, max);
  log.warn("ollama.context_overflow", { neededTokens: context.neededTokens, maxCtx: max, reduced: last !== prompt });
  return { prompt: last, context };
}

const DECK_SCHEMA = z.toJSONSchema(RawDeckSpecSchema, { io: "input", unrepresentable: "any" });
const CLASSIFY_SCHEMA = z.toJSONSchema(RawClassificationSchema, { io: "input", unrepresentable: "any" });
const TEMPLATE_SCHEMA = z.toJSONSchema(RawTemplateDraftSchema, { io: "input", unrepresentable: "any" });
const THEMES_SCHEMA = z.toJSONSchema(RawThemePromptDraftSchema, { io: "input", unrepresentable: "any" });
/** Brouillon de gabarit : court, mais un modèle local est lent. */
const DRAFT_TIMEOUT_MS = 120_000;
/** ~30 sections avec consigne + contraintes : ~3 000 jetons observés sur un prompt de 31 diapos ; marge ×2. */
const DRAFT_MAX_TOKENS = 6_000;
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
      ? "Le serveur Ollama ne répond pas. Réessayez plus tard ou choisissez un autre moteur dans la Configuration IA."
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
  /** Fixé par l'option (tests, réglage) ; sinon défaut, agrandi pour un gros deck (deckNumCtx). */
  const fixedNumCtx = options.numCtx;
  const semaphore = options.semaphore ?? sharedSemaphore;
  const queueWaitMs = options.queueWaitMs ?? DEFAULT_QUEUE_WAIT_MS;
  const production = options.production ?? process.env.NODE_ENV === "production";

  function timedOut(operation: string, timeoutMs: number, cause: unknown): AiUnavailableError {
    return new AiUnavailableError(`${operation}: délai dépassé`, {
      cause,
      userMessage: `Le modèle local n'a pas répondu dans le délai imparti (${Math.max(1, Math.round(timeoutMs / 60_000))} min). Réessayez, ou choisissez un modèle plus léger dans la Configuration IA.`,
    });
  }

  async function send(operation: string, prompt: PromptPair, format: unknown, maxTokens: number, timeoutMs: number, numCtx: number) {
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
        userMessage: "Ollama a renvoyé une erreur. Réessayez, ou choisissez un autre moteur dans la Configuration IA.",
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

  async function chat(
    operation: string,
    prompt: PromptPair,
    format: unknown,
    maxTokens: number,
    timeoutMs: number,
    numCtx: number = fixedNumCtx ?? DEFAULT_NUM_CTX,
  ) {
    try {
      return await semaphore.run(() => send(operation, prompt, format, maxTokens, timeoutMs, numCtx), queueWaitMs);
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
      const fitted = fitDeckPrompt(prompt, hints, fixedNumCtx);
      const numCtx = fixedNumCtx ?? fitted.context.numCtx;
      const text = await chat("generateDeck", fitted.prompt, DECK_SCHEMA, deckMaxTokens(hints?.template), deckTimeoutMs, numCtx);
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
