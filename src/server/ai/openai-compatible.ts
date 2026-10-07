import { z } from "zod";
import { PROVIDER_INFO, type CloudProvider, type KeySource } from "@/domain/ai-providers";
import type { PromptPair } from "@/domain/contracts";
import { normalizeDeckSpec, normalizeRawClassification, RawClassificationSchema, RawDeckSpecSchema } from "@/domain/normalize";
import { ClassificationSchema, DeckSpecSchema, type Classification, type DeckSpec } from "@/domain/schemas";
import {
  AiCreditExhaustedError,
  AiInvalidOutputError,
  AiKeyRejectedError,
  AiProviderRateLimitedError,
  AiRefusalError,
  AiUnavailableError,
} from "../errors";
import { createLogger } from "../logger";
import { deckMaxTokens } from "./anthropic";
import { PROVIDER_CATALOG } from "./catalog";
import { readBoundedText, ResponseTooLargeError } from "./http";
import { checkShape, parseJson, strict } from "./structured";
import { STRUCTURED_TASKS } from "./tasks";
import type { AiProvider, CallOptions, DeckHints, StructuredRequest, StructuredResult } from "./types";

/**
 * Adaptateur des API « Chat Completions » compatibles OpenAI (Mistral, Gemini via
 * sa couche OpenAI, OpenAI), en `fetch` seul (aucun SDK).
 *
 *   POST {baseUrl}/chat/completions  — baseUrl FIXE du catalogue, jamais saisie.
 *
 * Sortie structurée : `response_format: json_schema` strict, généré depuis le
 * schéma zod PERMISSIF du domaine (toutes les propriétés exigées, les
 * optionnelles rendues nulles). Si le fournisseur refuse ce format (400/422 qui
 * le cite), repli sur `json_object` avec le schéma dans le prompt système ; le
 * repli est mémorisé pour ce client. Puis, comme pour Claude : JSON → schéma
 * permissif → normalisation → validation stricte.
 *
 * Erreurs : 401/403 (et 400 « API key » de Gemini) → clé refusée ; 402 ou
 * `insufficient_quota` → crédit épuisé ; 429 → AiProviderRateLimitedError
 * (Retry-After, remboursable) ; 5xx, réseau, budget dépassé → indisponible.
 * Une clé d'ÉQUIPE refusée ou à sec est une panne de configuration
 * (AiUnavailableError, journalisée). AUCUNE nouvelle tentative ni bascule
 * automatique : le repli est proposé à l'utilisateur.
 */

export type OpenAiCompatibleId = Exclude<CloudProvider, "claude">;

const DEFAULT_DECK_BUDGET_MS = Number(process.env.AI_DECK_TIMEOUT_MS ?? 240_000);
const DEFAULT_CLASSIFY_BUDGET_MS = 90_000;
const DEFAULT_STRUCTURED_BUDGET_MS = 120_000;
const CLASSIFY_MAX_TOKENS = 4_000;
/** Plafond de sortie d'un deck (les modèles de ces fournisseurs plafonnent bien en dessous de 64 k). */
const DECK_MAX_TOKENS_CAP = 32_000;
const DEFAULT_RETRY_AFTER_S = 60;
const MAX_RETRY_AFTER_S = 3_600;

const log = createLogger({ component: "ai.openai_compatible" });

// ---------------------------------------------------------------------------
// Schéma JSON strict
// ---------------------------------------------------------------------------

type JsonNode = Record<string, unknown>;

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== "object") return node;
  const n = { ...(node as JsonNode) };
  if (Array.isArray(n.anyOf)) n.anyOf = n.anyOf.map(strictify);
  if (n.items !== undefined) n.items = strictify(n.items);
  if (n.type === "object" && n.properties && typeof n.properties === "object") {
    const required = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
    const properties: JsonNode = {};
    for (const [key, value] of Object.entries(n.properties as JsonNode)) {
      const child = strictify(value);
      properties[key] = required.has(key) ? child : { anyOf: [child, { type: "null" }] };
    }
    n.properties = properties;
    n.required = Object.keys(properties);
    n.additionalProperties = false;
  }
  return n;
}

/**
 * Schéma JSON « strict » au sens des Structured Outputs : chaque propriété est
 * exigée, une propriété optionnelle devient `T | null`, aucune propriété
 * additionnelle. Les `null` reçus sont ensuite lus comme « absent ».
 */
export function toStrictJsonSchema(schema: z.ZodType): JsonNode {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonNode;
  delete json.$schema;
  return strictify(json) as JsonNode;
}

const DECK_SCHEMA = toStrictJsonSchema(RawDeckSpecSchema);
const CLASSIFY_SCHEMA = toStrictJsonSchema(RawClassificationSchema);
const TASK_SCHEMAS = {
  juryQuestions: toStrictJsonSchema(STRUCTURED_TASKS.juryQuestions.raw),
  slide: toStrictJsonSchema(STRUCTURED_TASKS.slide.raw),
} as const;

// ---------------------------------------------------------------------------
// Réponses HTTP
// ---------------------------------------------------------------------------

const ChatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .nullable()
    .optional(),
});

interface ErrorInfo {
  message: string;
  type: string;
  code: string;
}

const ErrorObjectSchema = z.object({
  message: z.string().optional(),
  type: z.string().nullable().optional(),
  code: z.union([z.string(), z.number()]).nullable().optional(),
  status: z.string().optional(),
  param: z.string().nullable().optional(),
});

/** Corps d'erreur des trois dialectes : `{ error: {…} }` (OpenAI), `[{ error }]` (Google), `{ message, type }` (Mistral). */
function errorInfo(text: string): ErrorInfo {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { message: "", type: "", code: "" };
  }
  const first = Array.isArray(body) ? body[0] : body;
  const inner = first && typeof first === "object" && "error" in first ? (first as { error: unknown }).error : first;
  const parsed = ErrorObjectSchema.safeParse(inner);
  if (!parsed.success) return { message: "", type: "", code: "" };
  const e = parsed.data;
  return {
    message: (e.message ?? "").slice(0, 300),
    type: e.type ?? e.status ?? "",
    code: [e.code ?? "", e.param ?? ""].filter(Boolean).join(" "),
  };
}

/** Retry-After en secondes (entier ou date HTTP), borné ; défaut 60 s. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  const raw = header?.trim();
  let seconds = Number.NaN;
  if (raw) {
    if (/^\d+$/.test(raw)) seconds = Number(raw);
    else {
      const at = Date.parse(raw);
      if (Number.isFinite(at)) seconds = Math.ceil((at - now) / 1000);
    }
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_S;
  return Math.min(MAX_RETRY_AFTER_S, Math.max(1, Math.round(seconds)));
}

function mentionsSchema(info: ErrorInfo): boolean {
  return /response_format|json_schema|json schema|structured output|schema/i.test(`${info.message} ${info.code}`);
}

function mentionsApiKey(info: ErrorInfo): boolean {
  return /api[_ ]?key/i.test(`${info.message} ${info.code}`);
}

// ---------------------------------------------------------------------------
// Fournisseur
// ---------------------------------------------------------------------------

export interface OpenAiCompatibleOptions {
  provider: OpenAiCompatibleId;
  apiKey: string;
  model: string;
  /** "user" : une clé refusée ou à sec est une erreur attendue ; "server" : une panne de configuration. */
  keySource: KeySource;
  /** Injection pour les tests (réponses HTTP rejouées). */
  fetch?: typeof fetch;
  deckBudgetMs?: number;
  classifyBudgetMs?: number;
  structuredBudgetMs?: number;
}

type Mode = "json_schema" | "json_object";

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): AiProvider {
  const { provider, apiKey, model, keySource } = options;
  const entry = PROVIDER_CATALOG[provider];
  const label = PROVIDER_INFO[provider].label;
  const url = `${entry.baseUrl}/chat/completions`;
  const doFetch = options.fetch ?? fetch;
  const deckBudgetMs = options.deckBudgetMs ?? DEFAULT_DECK_BUDGET_MS;
  const classifyBudgetMs = options.classifyBudgetMs ?? DEFAULT_CLASSIFY_BUDGET_MS;
  const structuredBudgetMs = options.structuredBudgetMs ?? DEFAULT_STRUCTURED_BUDGET_MS;
  /** Mémorisé après un refus de json_schema : les appels suivants passent directement en json_object. */
  let preferredMode: Mode = entry.structured;

  const unavailableMessage = `${label} est momentanément indisponible. Réessayez dans un instant, ou choisissez un autre rédacteur dans la Configuration IA.`;

  function body(prompt: PromptPair, name: string, schema: JsonNode, maxTokens: number, mode: Mode) {
    const system =
      mode === "json_schema"
        ? prompt.system
        : `${prompt.system}\n\nRéponds uniquement par un objet JSON valide, conforme à ce schéma JSON (toutes les propriétés présentes, null quand une propriété est sans objet) :\n${JSON.stringify(schema)}`;
    return {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt.user },
      ],
      response_format: mode === "json_schema" ? { type: "json_schema", json_schema: { name, strict: true, schema } } : { type: "json_object" },
      [entry.maxTokensParam]: maxTokens,
    };
  }

  function timedOut(operation: string, cause: unknown): AiUnavailableError {
    return new AiUnavailableError(`${operation}: budget de temps dépassé`, {
      cause,
      userMessage: `${label} n'a pas répondu dans le délai imparti. Réessayez, ou choisissez un autre rédacteur dans la Configuration IA.`,
    });
  }

  function httpError(operation: string, status: number, info: ErrorInfo, retryAfter: string | null): Error {
    const fields = { operation, provider, keySource, status, type: info.type, code: info.code };
    if (status === 401 || status === 403 || (status === 400 && mentionsApiKey(info))) {
      if (keySource === "user") {
        log.warn("ai.user_key_rejected", fields);
        return new AiKeyRejectedError({ provider });
      }
      log.error("ai.config_error", fields);
      return new AiUnavailableError(`${operation}: clé d'équipe ${provider} refusée (${status})`, { userMessage: unavailableMessage });
    }
    if (status === 402 || /insufficient_quota/i.test(`${info.type} ${info.code}`)) {
      if (keySource === "user") {
        log.warn("ai.user_credit_exhausted", fields);
        return new AiCreditExhaustedError({ provider });
      }
      log.error("ai.server_credit_exhausted", fields);
      return new AiUnavailableError(`${operation}: crédit de la clé d'équipe ${provider} épuisé`, { userMessage: unavailableMessage });
    }
    if (status === 429) {
      const seconds = retryAfterSeconds(retryAfter);
      log.warn("ai.provider_rate_limited", { ...fields, retryAfterSeconds: seconds });
      return new AiProviderRateLimitedError(provider, seconds);
    }
    if (status === 404) {
      log.error("ai.model_not_found", { ...fields, model, message: info.message });
      return new AiUnavailableError(`${operation}: modèle ${model} introuvable chez ${provider}`, {
        userMessage: `Le modèle ${model} n'est pas disponible chez ${label} : choisissez-en un autre dans la Configuration IA.`,
      });
    }
    if (status >= 500) {
      log.warn("ai.provider_error", fields);
      return new AiUnavailableError(`${operation}: ${provider} HTTP ${status}`, { userMessage: unavailableMessage });
    }
    // Autre 4xx : notre requête est fautive. Panne (journalisée par l'appelant), jamais montrée telle quelle.
    log.error("ai.request_rejected", { ...fields, message: info.message });
    return new Error(`${operation}: requête refusée par ${provider} (HTTP ${status})`);
  }

  /** Un appel complet : envoi (avec repli json_object éventuel), lecture bornée, interprétation. Renvoie le JSON du modèle. */
  async function call(operation: string, prompt: PromptPair, name: string, schema: JsonNode, maxTokens: number, budgetMs: number) {
    const started = Date.now();
    const signal = AbortSignal.timeout(budgetMs);
    let mode = preferredMode;

    for (;;) {
      let response: Response;
      let text: string;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body(prompt, name, schema, maxTokens, mode)),
          redirect: "error",
          signal,
        });
        text = await readBoundedText(response);
      } catch (error) {
        if (error instanceof ResponseTooLargeError) {
          throw new AiInvalidOutputError(`${operation}: réponse ${provider} trop volumineuse`, { cause: error });
        }
        if (signal.aborted) throw timedOut(operation, error);
        throw new AiUnavailableError(`${operation}: connexion à ${provider}`, {
          cause: error,
          refundable: true,
          userMessage: `${label} est injoignable pour le moment. Réessayez dans un instant, ou choisissez un autre rédacteur dans la Configuration IA.`,
        });
      }

      if (!response.ok) {
        const info = errorInfo(text);
        if (mode === "json_schema" && (response.status === 400 || response.status === 422) && !mentionsApiKey(info) && mentionsSchema(info)) {
          log.warn("ai.structured_fallback", { operation, provider, model, status: response.status });
          mode = "json_object";
          preferredMode = "json_object";
          continue;
        }
        throw httpError(operation, response.status, info, response.headers.get("retry-after"));
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        throw new AiInvalidOutputError(`${operation}: réponse HTTP ${provider} non JSON`, { cause: error });
      }
      const parsed = ChatCompletionSchema.safeParse(raw);
      if (!parsed.success) throw new AiInvalidOutputError(`${operation}: réponse ${provider} inattendue`, { cause: parsed.error });
      const choice = parsed.data.choices[0]!;
      log.info("ai.call", {
        operation,
        provider,
        keySource,
        model,
        mode,
        finishReason: choice.finish_reason ?? null,
        inputTokens: parsed.data.usage?.prompt_tokens,
        outputTokens: parsed.data.usage?.completion_tokens,
        durationMs: Date.now() - started,
      });
      if (choice.message.refusal) throw new AiRefusalError(null);
      if (choice.finish_reason === "content_filter") throw new AiRefusalError("content_filter");
      if (choice.finish_reason === "length") throw new AiInvalidOutputError(`${operation}: réponse tronquée (plafond de jetons)`);
      return parseJson(operation, choice.message.content ?? "");
    }
  }

  const budget = (options: CallOptions | undefined, fallback: number) =>
    options?.budgetMs !== undefined && options.budgetMs > 0 ? options.budgetMs : fallback;

  return {
    name: `${provider}:${model}`,
    engine: provider,

    async generateDeck(prompt: PromptPair, hints?: DeckHints, callOptions?: CallOptions): Promise<DeckSpec> {
      const maxTokens = Math.min(DECK_MAX_TOKENS_CAP, deckMaxTokens(hints?.template));
      const json = await call("generateDeck", prompt, "deck", DECK_SCHEMA, maxTokens, budget(callOptions, deckBudgetMs));
      const raw = checkShape("generateDeck", json, RawDeckSpecSchema, { nullsAsMissing: true });
      return strict("generateDeck", DeckSpecSchema, normalizeDeckSpec(raw));
    },

    async classify(prompt: PromptPair, _hints?: unknown, callOptions?: CallOptions): Promise<Classification> {
      const json = await call("classify", prompt, "classification", CLASSIFY_SCHEMA, CLASSIFY_MAX_TOKENS, budget(callOptions, classifyBudgetMs));
      const raw = checkShape("classify", json, RawClassificationSchema, { nullsAsMissing: true });
      return strict("classify", ClassificationSchema, normalizeRawClassification(raw));
    },

    async generateStructured<R extends StructuredRequest>(req: R, callOptions?: CallOptions): Promise<StructuredResult<R>> {
      const spec = STRUCTURED_TASKS[req.task];
      const json = await call(req.task, req.prompt, spec.name, TASK_SCHEMAS[req.task], spec.maxTokens, budget(callOptions, structuredBudgetMs));
      return spec.finish(json, { nullsAsMissing: true }) as StructuredResult<R>;
    },
  };
}
