import { describe, expect, it } from "vitest";
import type { PromptPair } from "@/domain/contracts";
import { DeckSpecSchema } from "@/domain/schemas";
import { createAnthropicProvider } from "@/server/ai/anthropic";
import type { DeckHints } from "@/server/ai/types";
import { AiCreditExhaustedError, AiInvalidOutputError, AiKeyRejectedError, AiRefusalError, AiUnavailableError } from "@/server/errors";
import { makeConformingDeck, makeTemplate, makeThemes } from "@/test/fixtures";

/**
 * Le SDK est piloté par un `fetch` factice : on rejoue les réponses HTTP de
 * l'API (JSON ou flux SSE) sans réseau, pour tester ce que fait le fournisseur
 * de chaque cas limite (troncature, refus, JSON invalide, sortie trop longue,
 * pannes, budget de temps).
 */

const PROMPT: PromptPair = { system: "s", user: "u" };
const HINTS: DeckHints = { template: makeTemplate(), subject: makeThemes()[0]!, programName: "P", problem: "Une problématique ?" };

interface Reply {
  status?: number;
  text?: string;
  stopReason?: string;
  stopDetails?: { type: "refusal"; category: string | null; explanation: string | null } | null;
  /** Corps d'erreur JSON (statut >= 400). */
  errorBody?: unknown;
  /** Ne répond jamais (jusqu'à l'abandon par le signal). */
  hang?: boolean;
}

interface Captured {
  body: Record<string, unknown>;
  headers: Headers;
}

function message(reply: Reply) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
    stop_reason: reply.stopReason ?? "end_turn",
    stop_sequence: null,
    stop_details: reply.stopDetails ?? null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

function sse(reply: Reply): string {
  const events: [string, unknown][] = [
    ["message_start", { type: "message_start", message: { ...message({}), content: [], stop_reason: null } }],
  ];
  if (reply.text !== undefined) {
    events.push(["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply.text } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index: 0 }]);
  }
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: reply.stopReason ?? "end_turn", stop_sequence: null, stop_details: reply.stopDetails ?? null },
      usage: { output_tokens: 20 },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}

function fakeFetch(replies: Reply[]) {
  const calls: Captured[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body, headers: new Headers(init?.headers) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (reply.hang) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if (reply.status && reply.status >= 400) {
      return new Response(JSON.stringify(reply.errorBody ?? { type: "error", error: { type: "api_error", message: "boom" } }), {
        status: reply.status,
        headers: { "content-type": "application/json", "x-should-retry": "true", "retry-after-ms": "10" },
      });
    }
    if (body.stream === true) {
      return new Response(sse(reply), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify(message(reply)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

function provider(
  replies: Reply[],
  options: { deckBudgetMs?: number; classifyBudgetMs?: number; keySource?: "user" | "server" } = {},
) {
  const { fetchImpl, calls } = fakeFetch(replies);
  return { ai: createAnthropicProvider({ apiKey: "test-key", fetch: fetchImpl, ...options }), calls };
}

const VALID_DECK = JSON.stringify(makeConformingDeck());

describe("createAnthropicProvider — generateDeck", () => {
  it("devrait renvoyer le deck quand la réponse est conforme", async () => {
    const { ai } = provider([{ text: VALID_DECK }]);
    expect(await ai.generateDeck(PROMPT, HINTS)).toEqual(makeConformingDeck());
  });

  it("devrait lever AiInvalidOutputError (pas une panne générique) quand la réponse est tronquée par max_tokens", async () => {
    const { ai } = provider([{ text: VALID_DECK.slice(0, 120), stopReason: "max_tokens" }]);
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait lever AiRefusalError quand le modèle refuse, même sans contenu exploitable", async () => {
    const { ai } = provider([
      { text: "{", stopReason: "refusal", stopDetails: { type: "refusal", category: "cyber", explanation: null } },
    ]);
    const error = await ai.generateDeck(PROMPT, HINTS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiRefusalError);
    expect((error as AiRefusalError).category).toBe("cyber");
  });

  it("devrait lever AiInvalidOutputError quand le JSON est invalide", async () => {
    const { ai } = provider([{ text: "pas du json" }]);
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait normaliser une réponse un peu trop longue au lieu d'échouer", async () => {
    const deck = makeConformingDeck();
    const tooLong = {
      ...deck,
      slides: deck.slides.map((s, i) =>
        i === 3 ? { ...s, bullets: Array.from({ length: 8 }, (_, k) => `Puce ${k} ${"détail ".repeat(50)}`) } : s,
      ),
    };
    const { ai } = provider([{ text: JSON.stringify(tooLong) }]);
    const out = await ai.generateDeck(PROMPT, HINTS);
    expect(DeckSpecSchema.safeParse(out).success).toBe(true);
    expect(out.slides[3]!.bullets).toHaveLength(6);
  });

  it("devrait demander en streaming, sans température ni prefill, avec effort medium et repli serveur", async () => {
    const { ai, calls } = provider([{ text: VALID_DECK }]);
    await ai.generateDeck(PROMPT, HINTS);
    const { body, headers } = calls[0]!;
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty("temperature");
    expect(body.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    const messages = body.messages as { role: string }[];
    expect(messages.at(-1)!.role).toBe("user");
  });

  it("devrait dimensionner max_tokens d'après la taille du gabarit", async () => {
    const small = provider([{ text: VALID_DECK }]);
    await small.ai.generateDeck(PROMPT, HINTS);
    const bigTemplate = makeTemplate({
      sections: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, guidance: "", slides: 8 })),
    });
    const big = provider([{ text: VALID_DECK }]);
    await big.ai.generateDeck(PROMPT, { ...HINTS, template: bigTemplate });
    const smallMax = small.calls[0]!.body.max_tokens as number;
    const bigMax = big.calls[0]!.body.max_tokens as number;
    expect(smallMax).toBeGreaterThanOrEqual(8000);
    expect(bigMax).toBeGreaterThan(smallMax);
    expect(bigMax).toBeLessThanOrEqual(64000);
  });

  it("ne devrait faire aucune nouvelle tentative sur une panne 500 (budget de temps maîtrisé)", async () => {
    const { ai, calls } = provider([{ status: 500 }, { text: VALID_DECK }]);
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it("devrait abandonner au bout du budget total et lever AiUnavailableError", async () => {
    const { ai } = provider([{ hang: true }], { deckBudgetMs: 50 });
    const started = Date.now();
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("createAnthropicProvider — classify", () => {
  const VALID = JSON.stringify({
    reformulatedProblem: "Reformulation",
    candidates: [{ themeId: "theme-ville", confidence: 0.8, rationale: "Parce que" }],
  });

  it("devrait demander un effort low et renvoyer la classification", async () => {
    const { ai, calls } = provider([{ text: VALID }]);
    const out = await ai.classify(PROMPT);
    expect(out.candidates[0]!.themeId).toBe("theme-ville");
    expect(calls[0]!.body.output_config).toMatchObject({ effort: "low" });
  });

  it("devrait réessayer une seule fois sur une panne 500", async () => {
    const { ai, calls } = provider([{ status: 500 }, { status: 500 }, { text: VALID }]);
    await expect(ai.classify(PROMPT)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(calls).toHaveLength(2);
  });

  it("devrait normaliser une justification trop longue", async () => {
    const long = JSON.stringify({
      reformulatedProblem: "R".repeat(900),
      candidates: [{ themeId: "theme-ville", confidence: 0.8, rationale: "x".repeat(900) }],
    });
    const { ai } = provider([{ text: long }]);
    const out = await ai.classify(PROMPT);
    expect(out.reformulatedProblem.length).toBeLessThanOrEqual(600);
    expect(out.candidates[0]!.rationale.length).toBeLessThanOrEqual(600);
  });

  it("devrait lever AiInvalidOutputError quand la réponse est tronquée", async () => {
    const { ai } = provider([{ text: VALID.slice(0, 20), stopReason: "max_tokens" }]);
    await expect(ai.classify(PROMPT)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });
});

describe("createAnthropicProvider — clé refusée (401/403)", () => {
  it.each([401, 403])("devrait lever AiKeyRejectedError (message Configuration IA) quand la clé de l'utilisateur est refusée (%s)", async (status) => {
    const { ai, calls } = provider([{ status }], { keySource: "user" });
    const error = await ai.generateDeck(PROMPT, HINTS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiKeyRejectedError);
    expect((error as AiKeyRejectedError).userMessage).toBe(
      "Votre clé API Anthropic est refusée. Mettez-la à jour dans la Rédaction IA.",
    );
    expect(calls).toHaveLength(1);
  });

  it("devrait lever AiKeyRejectedError aussi pour la classification avec la clé de l'utilisateur", async () => {
    const { ai } = provider([{ status: 401 }], { keySource: "user" });
    await expect(ai.classify(PROMPT)).rejects.toBeInstanceOf(AiKeyRejectedError);
  });

  it("devrait rester une indisponibilité (configuration serveur) quand la clé serveur est refusée", async () => {
    const { ai } = provider([{ status: 401 }], { keySource: "server" });
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe("createAnthropicProvider — crédit épuisé (400 credit balance)", () => {
  const CREDIT = {
    status: 400,
    errorBody: {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    },
  };

  it("devrait lever AiCreditExhaustedError avec la clé de l'utilisateur", async () => {
    const { ai } = provider([CREDIT], { keySource: "user" });
    const error = (await ai.generateDeck(PROMPT, HINTS).catch((e: unknown) => e)) as AiCreditExhaustedError;
    expect(error).toBeInstanceOf(AiCreditExhaustedError);
    expect(error.userMessage).toBe(
      "Votre compte Anthropic n'a plus de crédit. Rechargez-le sur console.anthropic.com ou choisissez Sans IA dans la Rédaction IA.",
    );
  });

  it("devrait être une indisponibilité (pas un message sur « votre compte ») avec la clé du serveur", async () => {
    const { ai } = provider([CREDIT], { keySource: "server" });
    await expect(ai.classify(PROMPT)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("devrait laisser une autre 400 remonter comme une panne", async () => {
    const { ai } = provider([{ status: 400 }], { keySource: "user" });
    const error = await ai.generateDeck(PROMPT, HINTS).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(AiCreditExhaustedError);
    expect(error).not.toBeInstanceOf(AiUnavailableError);
  });
});

describe("createAnthropicProvider — surface", () => {
  it("ne devrait plus exposer que la rédaction du deck et la reconnaissance (imports sans IA)", () => {
    const { ai } = provider([]);
    expect(Object.keys(ai).sort()).toEqual(["classify", "engine", "generateDeck", "generateStructured", "name"]);
  });
});

describe("createAnthropicProvider — 1.2 : budget par appel et tâches structurées", () => {
  it("devrait respecter CallOptions.budgetMs plutôt que le budget par défaut", async () => {
    const { ai } = provider([{ hang: true }], { deckBudgetMs: 60_000 });
    const started = Date.now();
    const error = await ai.generateDeck(PROMPT, HINTS, { budgetMs: 40 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("devrait produire les questions du jury avec un format JSON dédié, normalisées et validées", async () => {
    const { ai, calls } = provider([{ text: JSON.stringify({ questions: [{ question: " Pourquoi ? ", answer: "Parce que." }] }) }]);
    expect(await ai.generateStructured({ task: "juryQuestions", prompt: PROMPT })).toEqual({
      questions: [{ question: "Pourquoi ?", answer: "Parce que." }],
    });
    const format = (calls[0]!.body.output_config as { format: { type: string; schema: { properties: Record<string, unknown> } } }).format;
    expect(format.type).toBe("json_schema");
    expect(Object.keys(format.schema.properties)).toEqual(["questions"]);
    expect(calls[0]!.body.stream).toBeFalsy();
  });

  it("devrait produire une diapo, et refuser une sortie vide de questions", async () => {
    const { ai } = provider([
      { text: JSON.stringify({ layout: "content", sectionId: "p1", title: "Titre", bullets: ["A"] }) },
      { text: JSON.stringify({ questions: [] }) },
    ]);
    expect(await ai.generateStructured({ task: "slide", prompt: PROMPT })).toEqual({
      layout: "content",
      sectionId: "p1",
      title: "Titre",
      subtitle: "",
      bullets: ["A"],
      notes: "",
    });
    await expect(ai.generateStructured({ task: "juryQuestions", prompt: PROMPT })).rejects.toBeInstanceOf(AiInvalidOutputError);
  });
});
