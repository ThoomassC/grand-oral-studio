import { describe, expect, it } from "vitest";
import { RawSlideSchema } from "@/domain/normalize";
import { makeTemplate } from "@/test/fixtures";
import { createOpenAiCompatibleProvider, toStrictJsonSchema } from "@/server/ai/openai-compatible";
import {
  AiCreditExhaustedError,
  AiInvalidOutputError,
  AiKeyRejectedError,
  AiProviderRateLimitedError,
  AiRefusalError,
  AiUnavailableError,
  isRefundableAiError,
} from "@/server/errors";

const KEY = `sk-proj-${"k".repeat(40)}`;
const PROMPT = { system: "Tu rédiges un diaporama.", user: "Problématique : le numérique." };

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

type Reply = Response | ((signal: AbortSignal | undefined) => Promise<Response>);

/** `fetch` factice : rejoue les réponses dans l'ordre et capture chaque requête (aucun appel réseau). */
function fakeFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const reply = replies.shift();
    if (!reply) throw new Error("appel inattendu");
    return typeof reply === "function" ? reply(init.signal ?? undefined) : reply;
  };
  return { impl, calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function completion(content: unknown, extra: { finish_reason?: string; refusal?: string | null } = {}): Response {
  return json(200, {
    id: "c1",
    model: "m",
    choices: [
      {
        index: 0,
        finish_reason: extra.finish_reason ?? "stop",
        message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content), refusal: extra.refusal ?? null },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
}

const RAW_DECK = {
  title: "Le numérique",
  subtitle: null,
  slides: [
    { layout: "title", sectionId: "cover", title: "Le numérique", subtitle: "Grand oral", bullets: null, notes: "Annoncer." },
    { layout: "content", sectionId: "intro", title: "Introduction", subtitle: null, bullets: ["Un", "Deux"], notes: null },
  ],
};

function provider(fetchImpl: typeof fetch, over: Partial<Parameters<typeof createOpenAiCompatibleProvider>[0]> = {}) {
  return createOpenAiCompatibleProvider({
    provider: "mistral",
    apiKey: KEY,
    model: "mistral-large-latest",
    keySource: "user",
    fetch: fetchImpl,
    ...over,
  });
}

describe("toStrictJsonSchema", () => {
  it("devrait rendre toutes les propriétés obligatoires, les optionnelles nulles, sans propriété additionnelle", () => {
    const schema = toStrictJsonSchema(RawSlideSchema) as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { type?: unknown; anyOf?: unknown[] }>;
      $schema?: string;
    };
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(["bullets", "layout", "notes", "sectionId", "subtitle", "title"]);
    expect(schema.properties.title).toEqual({ type: "string" });
    expect(schema.properties.subtitle!.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
  });
});

describe("createOpenAiCompatibleProvider — sortie structurée", () => {
  it("devrait appeler l'URL fixe du fournisseur avec la clé en Bearer et un json_schema strict", async () => {
    const f = fakeFetch(completion(RAW_DECK));
    const deck = await provider(f.impl).generateDeck(PROMPT, undefined);
    expect(deck.slides).toHaveLength(2);
    expect(deck.subtitle).toBe("");
    expect(deck.slides[1]!.bullets).toEqual(["Un", "Deux"]);

    const [call] = f.calls;
    expect(call!.url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(call!.init.method).toBe("POST");
    expect(call!.init.redirect).toBe("error");
    expect(new Headers(call!.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(call!.body).toMatchObject({
      model: "mistral-large-latest",
      messages: [
        { role: "system", content: PROMPT.system },
        { role: "user", content: PROMPT.user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "deck", strict: true } },
    });
    expect(call!.body.max_tokens).toBeTypeOf("number");
    expect(call!.body).not.toHaveProperty("temperature");
  });

  it("devrait utiliser max_completion_tokens chez OpenAI", async () => {
    const f = fakeFetch(completion(RAW_DECK));
    await provider(f.impl, { provider: "openai", model: "gpt-5-mini" }).generateDeck(PROMPT, { template: makeTemplate() } as never);
    expect(f.calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(f.calls[0]!.body.max_completion_tokens).toBeTypeOf("number");
    expect(f.calls[0]!.body).not.toHaveProperty("max_tokens");
  });

  it("devrait se replier sur json_object (schéma dans le prompt) quand json_schema est refusé, puis s'en souvenir", async () => {
    const refused = json(400, { error: { message: "Invalid response_format: json_schema is not supported for this model", type: "invalid_request_error" } });
    const f = fakeFetch(refused, completion(RAW_DECK), completion(RAW_DECK));
    const p = provider(f.impl, { provider: "gemini", model: "gemini-2.5-flash", apiKey: `AIza${"g".repeat(35)}` });
    await p.generateDeck(PROMPT);
    expect(f.calls.map((c) => (c.body.response_format as { type: string }).type)).toEqual(["json_schema", "json_object"]);
    const system = (f.calls[1]!.body.messages as { content: string }[])[0]!.content;
    expect(system).toContain(PROMPT.system);
    expect(system).toMatch(/JSON/);
    expect(system).toContain('"slides"');
    expect(f.calls[1]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");

    await p.generateDeck(PROMPT);
    expect((f.calls[2]!.body.response_format as { type: string }).type).toBe("json_object");
  });

  it("devrait produire les questions du jury et une diapo (generateStructured)", async () => {
    const f = fakeFetch(
      completion({ questions: [{ question: "  Pourquoi ce sujet ?  ", answer: "Parce que." }, { question: "", answer: "vide" }] }),
      completion({ layout: "CONTENT", sectionId: "p1", title: "Partie 1", subtitle: null, bullets: ["A"], notes: "Dire A." }),
    );
    const p = provider(f.impl);
    const jury = await p.generateStructured({ task: "juryQuestions", prompt: PROMPT });
    expect(jury).toEqual({ questions: [{ question: "Pourquoi ce sujet ?", answer: "Parce que." }] });
    expect(f.calls[0]!.body.response_format).toMatchObject({ json_schema: { name: "jury_questions" } });

    const slide = await p.generateStructured({ task: "slide", prompt: PROMPT });
    expect(slide).toEqual({ layout: "content", sectionId: "p1", title: "Partie 1", subtitle: "", bullets: ["A"], notes: "Dire A." });
  });

  it("devrait classer un sujet", async () => {
    const f = fakeFetch(completion({ reformulatedProblem: "Le numérique", candidates: [{ themeId: "t1", confidence: 0.8, rationale: "Proche." }] }));
    const result = await provider(f.impl).classify(PROMPT);
    expect(result.candidates[0]).toMatchObject({ themeId: "t1", confidence: 0.8 });
  });
});

describe("createOpenAiCompatibleProvider — erreurs", () => {
  it("devrait signaler une clé UTILISATEUR refusée (401), avec le nom du fournisseur", async () => {
    const f = fakeFetch(json(401, { error: { message: "Unauthorized" } }));
    const error = await provider(f.impl).generateDeck(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiKeyRejectedError);
    expect((error as AiKeyRejectedError).userMessage).toMatch(/Mistral/);
    expect((error as AiKeyRejectedError).userMessage).not.toContain(KEY);
  });

  it("devrait traiter une clé d'ÉQUIPE refusée (403) comme une indisponibilité", async () => {
    const f = fakeFetch(json(403, { error: { message: "Forbidden" } }));
    await expect(provider(f.impl, { keySource: "server" }).generateDeck(PROMPT)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("devrait reconnaître la clé Gemini invalide (400 API_KEY_INVALID)", async () => {
    const f = fakeFetch(json(400, [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }]));
    const p = provider(f.impl, { provider: "gemini", model: "gemini-2.5-flash" });
    const error = await p.generateDeck(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiKeyRejectedError);
    expect((error as AiKeyRejectedError).userMessage).toMatch(/Gemini/);
  });

  it("devrait signaler un crédit épuisé (402)", async () => {
    const f = fakeFetch(json(402, { error: { message: "Payment required" } }));
    const error = await provider(f.impl).generateDeck(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiCreditExhaustedError);
    expect((error as AiCreditExhaustedError).userMessage).toMatch(/Mistral/);
  });

  it("devrait signaler un crédit épuisé sur 429 insufficient_quota (OpenAI), sans le confondre avec une limite de débit", async () => {
    const f = fakeFetch(json(429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }));
    const error = await provider(f.impl, { provider: "openai", model: "gpt-5-mini" }).generateDeck(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiCreditExhaustedError);
    expect((error as AiCreditExhaustedError).userMessage).toMatch(/OpenAI/);
  });

  it("devrait signaler une limite de débit (429) avec Retry-After, remboursable, sans nouvelle tentative", async () => {
    const f = fakeFetch(json(429, { error: { message: "Rate limit" } }, { "retry-after": "30" }));
    const error = await provider(f.impl).generateDeck(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderRateLimitedError);
    expect(error).toMatchObject({ code: "AI_RATE_LIMITED", status: 429, retryAfterSeconds: 30, provider: "mistral" });
    expect((error as AiProviderRateLimitedError).userMessage).toMatch(/Mistral.*30 s/);
    expect(isRefundableAiError(error)).toBe(true);
    expect(f.calls).toHaveLength(1);
  });

  it("devrait borner un Retry-After absent ou extravagant", async () => {
    const f = fakeFetch(json(429, {}), json(429, {}, { "retry-after": "999999" }));
    const p = provider(f.impl);
    expect(await p.generateDeck(PROMPT).catch((e: unknown) => e)).toMatchObject({ retryAfterSeconds: 60 });
    expect(await p.generateDeck(PROMPT).catch((e: unknown) => e)).toMatchObject({ retryAfterSeconds: 3600 });
  });

  it("devrait signaler une indisponibilité sur 5xx (non remboursable) et sur panne réseau (remboursable)", async () => {
    const f = fakeFetch(json(503, { error: { message: "overloaded" } }), async () => Promise.reject(new TypeError("fetch failed")));
    const p = provider(f.impl);
    const down = await p.generateDeck(PROMPT).catch((e: unknown) => e);
    expect(down).toBeInstanceOf(AiUnavailableError);
    expect((down as AiUnavailableError).userMessage).toMatch(/Mistral/);
    expect(isRefundableAiError(down)).toBe(false);
    const offline = await p.generateDeck(PROMPT).catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(AiUnavailableError);
    expect(isRefundableAiError(offline)).toBe(true);
  });

  it("ne devrait pas rembourser une coupure pendant la lecture du corps : la réponse a déjà été calculée", async () => {
    const encoder = new TextEncoder();
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"id":"c1","choices":['));
        controller.error(new TypeError("terminated"));
      },
    });
    const f = fakeFetch(new Response(cut, { status: 200, headers: { "content-type": "application/json" } }));
    const error = await provider(f.impl).generateDeck(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(isRefundableAiError(error)).toBe(false);
  });

  it("devrait rejeter une sortie JSON invalide, tronquée ou refusée", async () => {
    const f = fakeFetch(
      completion("{ pas du json"),
      completion({ title: "x" }),
      completion(RAW_DECK, { finish_reason: "length" }),
      completion("", { refusal: "Je ne peux pas." }),
    );
    const p = provider(f.impl);
    await expect(p.generateDeck(PROMPT)).rejects.toBeInstanceOf(AiInvalidOutputError);
    await expect(p.generateDeck(PROMPT)).rejects.toBeInstanceOf(AiInvalidOutputError);
    await expect(p.generateDeck(PROMPT)).rejects.toBeInstanceOf(AiInvalidOutputError);
    await expect(p.generateDeck(PROMPT)).rejects.toBeInstanceOf(AiRefusalError);
  });

  it("devrait respecter le budget de l'appel (AbortSignal) et signaler une indisponibilité", async () => {
    const hang = (signal: AbortSignal | undefined) =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    const f = fakeFetch(hang);
    const started = Date.now();
    const error = await provider(f.impl).generateDeck(PROMPT, undefined, { budgetMs: 30 }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).detail).toMatch(/budget/);
    expect(isRefundableAiError(error)).toBe(false);
  });

  it("ne devrait pas suivre la réponse d'un modèle inconnu (404) comme une panne silencieuse", async () => {
    const f = fakeFetch(json(404, { error: { message: "model not found" } }));
    const error = await provider(f.impl).generateDeck(PROMPT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).userMessage).toMatch(/modèle/);
  });
});
