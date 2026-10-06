import { describe, expect, it, vi } from "vitest";
import type { PromptPair } from "@/domain/contracts";
import { createOllamaProvider, deckContext, listOllamaModels } from "@/server/ai/ollama";
import type { DeckHints } from "@/server/ai/types";
import { AiInvalidOutputError, AiUnavailableError } from "@/server/errors";
import { makeConformingDeck, makeTemplate, makeThemes } from "@/test/fixtures";

const PROMPT: PromptPair = { system: "sys", user: "usr" };
const HINTS: DeckHints = { template: makeTemplate(), subject: makeThemes()[0]!, programName: "P", problem: "Une problématique ?" };
const BASE = "http://localhost:11434";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function fakeFetch(respond: (call: Call, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url, method: init?.method ?? "GET", body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    calls.push(call);
    return respond(call, init);
  };
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const chat = (content: string, doneReason = "stop") =>
  json(200, { model: "mistral", message: { role: "assistant", content }, done: true, done_reason: doneReason, eval_count: 10 });

function provider(respond: Parameters<typeof fakeFetch>[0], timeoutMs = 5_000) {
  const { impl, calls } = fakeFetch(respond);
  return {
    ai: createOllamaProvider({ baseUrl: BASE, model: "mistral", fetch: impl, timeoutMs, production: false }),
    calls,
  };
}

describe("createOllamaProvider — contexte (num_ctx) d'un deck", () => {
  function sections(n: number, slides: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Section ${i}`, guidance: "", slides }));
  }

  it("devrait garder 16 k pour un petit deck", async () => {
    const { ai, calls } = provider(() => chat(JSON.stringify(makeConformingDeck())));
    await ai.generateDeck(PROMPT, HINTS);
    expect((calls[0]!.body?.options as { num_ctx: number }).num_ctx).toBe(16_384);
  });

  it("devrait agrandir le contexte pour un deck de 31 diapos avec un long prompt (trame + notes du sujet), plafonné à 32 k", async () => {
    const big: DeckHints = { ...HINTS, template: makeTemplate({ sections: sections(15, 2) }) };
    const long: PromptPair = { system: "s".repeat(6_000), user: "u".repeat(30_000) };
    const { impl, calls } = fakeFetch(() => json(200, { message: { content: "{}" }, done: true, done_reason: "stop" }));
    const ai = createOllamaProvider({ baseUrl: BASE, model: "m", fetch: impl, production: false });
    await ai.generateDeck(long, big).catch(() => undefined);
    const numCtx = (calls[0]!.body?.options as { num_ctx: number }).num_ctx;
    expect(numCtx).toBeGreaterThan(16_384);
    expect(numCtx).toBeLessThanOrEqual(32_768);
  });
});

describe("deckContext — estimation du contexte et dépassement du plafond", () => {
  it("devrait tenir dans le plafond pour un petit prompt", () => {
    const ctx = deckContext(PROMPT, makeTemplate());
    expect(ctx).toMatchObject({ numCtx: 16_384, fits: true });
  });

  it("devrait signaler qu'un prompt trop long dépasse le plafond de 32 k (Ollama tronquerait le début)", () => {
    const huge: PromptPair = { system: "s".repeat(10_000), user: "u".repeat(90_000) };
    const ctx = deckContext(huge, makeTemplate());
    expect(ctx.fits).toBe(false);
    expect(ctx.numCtx).toBe(32_768);
    // ~3 caractères par jeton : 100 000 caractères ≈ 33 334 jetons de prompt, plus la sortie.
    expect(ctx.neededTokens).toBeGreaterThan(33_334);
  });
});

describe("createOllamaProvider — prompt trop long pour le contexte", () => {
  const huge: PromptPair = { system: "règles", user: `début ${"u".repeat(110_000)}` };
  const asked: number[] = [];
  const compact = (max: number): PromptPair => {
    asked.push(max);
    return { system: "règles", user: max >= 1500 ? "u".repeat(100_000) : `notes ${max}` };
  };

  it("devrait raccourcir les notes du sujet par paliers (1500, 600, 0) pour tenir dans le plafond, journalisé sans données utilisateur", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    asked.length = 0;
    try {
      const { ai, calls } = provider(() => chat(JSON.stringify(makeConformingDeck())));
      await ai.generateDeck(huge, { ...HINTS, compactPrompt: compact });
      expect(asked).toEqual([1500, 600]);
      const messages = calls[0]!.body?.messages as { content: string }[];
      expect(messages[1]!.content).toBe("notes 600");
      expect((calls[0]!.body?.options as { num_ctx: number }).num_ctx).toBeLessThanOrEqual(32_768);
      const logged = warn.mock.calls.map((args) => String(args[0])).join("\n");
      expect(logged).toContain("ollama.context_reduced");
      expect(logged).toContain("subjectNotesMax");
      expect(logged).not.toContain("skeleton");
      expect(logged).not.toContain("début");
    } finally {
      warn.mockRestore();
    }
  });

  it("devrait journaliser un avertissement quand le prompt ne peut pas être réduit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ai, calls } = provider(() => chat(JSON.stringify(makeConformingDeck())));
      await ai.generateDeck(huge, HINTS);
      expect(calls).toHaveLength(1);
      const logged = warn.mock.calls.map((args) => String(args[0])).join("\n");
      expect(logged).toContain("ollama.context_overflow");
      expect(logged).not.toContain("début");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("createOllamaProvider — generateDeck", () => {
  it("devrait appeler POST /api/chat en flux (en-têtes reçus dès le premier jeton), avec un schéma JSON, et renvoyer un deck validé", async () => {
    const { ai, calls } = provider(() => chat(JSON.stringify(makeConformingDeck())));
    expect(await ai.generateDeck(PROMPT, HINTS)).toEqual(makeConformingDeck());
    expect(ai.engine).toBe("ollama");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${BASE}/api/chat`);
    expect(call.method).toBe("POST");
    expect(call.body).toMatchObject({
      model: "mistral",
      stream: true,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
    expect(call.body?.format).toMatchObject({ type: "object" });
    const options = call.body?.options as { temperature: number };
    expect(options.temperature).toBeGreaterThan(0);
    expect(options.temperature).toBeLessThanOrEqual(0.7);
  });

  it("devrait assembler un deck reçu en morceaux NDJSON, même coupés au milieu d'une ligne", async () => {
    const content = JSON.stringify(makeConformingDeck());
    const third = Math.ceil(content.length / 3);
    const lines = [0, 1, 2].map((i) =>
      JSON.stringify({ message: { role: "assistant", content: content.slice(i * third, (i + 1) * third) }, done: false }),
    );
    lines.push(JSON.stringify({ message: { role: "assistant", content: "" }, done: true, done_reason: "stop", eval_count: 42 }));
    const raw = new TextEncoder().encode(`${lines.join("\n")}\n`);
    const cut = [0, 37, Math.floor(raw.length / 2), raw.length - 5, raw.length];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 1; i < cut.length; i += 1) controller.enqueue(raw.slice(cut[i - 1], cut[i]));
        controller.close();
      },
    });
    const { ai } = provider(() => new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    expect(await ai.generateDeck(PROMPT, HINTS)).toEqual(makeConformingDeck());
  });

  it("devrait lever AiUnavailableError quand Ollama signale une erreur au milieu du flux", async () => {
    const body = `${JSON.stringify({ message: { content: "{\"title\"" }, done: false })}\n${JSON.stringify({ error: "llama runner process has terminated" })}\n`;
    const { ai } = provider(() => new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("devrait lever AiInvalidOutputError quand le flux s'arrête avant la fin (aucun morceau final)", async () => {
    const body = `${JSON.stringify({ message: { content: JSON.stringify(makeConformingDeck()) }, done: false })}\n`;
    const { ai } = provider(() => new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait lever AiInvalidOutputError quand le JSON est invalide", async () => {
    const { ai } = provider(() => chat("{ pas du json"));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait lever AiInvalidOutputError quand la réponse est tronquée (done_reason=length)", async () => {
    const { ai } = provider(() => chat(JSON.stringify(makeConformingDeck()).slice(0, 50), "length"));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait lever AiInvalidOutputError quand la forme JSON est inattendue", async () => {
    const { ai } = provider(() => chat(JSON.stringify({ foo: 1 })));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait lever AiInvalidOutputError quand la réponse HTTP n'a pas la forme d'Ollama", async () => {
    const { ai } = provider(() => json(200, { unexpected: true }));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait dire de lancer Ollama quand il ne répond pas (connexion refusée), sans nouvelle tentative", async () => {
    const { ai, calls } = provider(() => {
      throw new TypeError("fetch failed");
    });
    const error = await ai.generateDeck(PROMPT, HINTS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect((error as AiUnavailableError).userMessage).toBe(
      `Ollama ne répond pas à ${BASE} : vérifiez qu'il est lancé (ollama serve).`,
    );
    expect(calls).toHaveLength(1);
  });

  it("ne devrait pas révéler l'URL interne d'Ollama en production", async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const ai = createOllamaProvider({ baseUrl: "http://ollama.interne:11434", model: "m", fetch: impl, production: true });
    const error = (await ai.classify(PROMPT).catch((e: unknown) => e)) as AiUnavailableError;
    expect(error.userMessage).not.toContain("ollama.interne");
  });

  it("devrait dire d'installer le modèle quand Ollama répond 404 « not found »", async () => {
    const { ai } = provider(() => json(404, { error: "model 'mistral' not found, try pulling it first" }));
    const error = (await ai.generateDeck(PROMPT, HINTS).catch((e: unknown) => e)) as AiUnavailableError;
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.userMessage).toBe("Le modèle mistral n'est pas installé : ollama pull mistral");
  });

  it("devrait traduire une 5xx d'Ollama en indisponibilité", async () => {
    const { ai } = provider(() => json(500, { error: "out of memory" }));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("devrait abandonner au-delà du délai imparti", async () => {
    const { ai } = provider(
      (_call, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
        }),
      30,
    );
    const error = (await ai.generateDeck(PROMPT, HINTS).catch((e: unknown) => e)) as AiUnavailableError;
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.userMessage).toMatch(/délai/);
  });
});

describe("createOllamaProvider — classify", () => {
  it("devrait renvoyer une classification validée", async () => {
    const raw = { reformulatedProblem: "Pb", candidates: [{ themeId: "t1", confidence: 0.8, rationale: "r" }] };
    const { ai } = provider(() => chat(JSON.stringify(raw)));
    const result = await ai.classify(PROMPT);
    expect(result.candidates[0]!.themeId).toBe("t1");
  });
});

describe("listOllamaModels", () => {
  it("devrait lister les modèles installés via GET /api/tags", async () => {
    const { impl, calls } = fakeFetch(() =>
      json(200, { models: [{ name: "mistral:latest", model: "mistral:latest", size: 1 }, { name: "llama3.2:latest" }] }),
    );
    expect(await listOllamaModels(BASE, { fetch: impl })).toEqual({ reachable: true, models: ["llama3.2:latest", "mistral:latest"] });
    expect(calls[0]!.url).toBe(`${BASE}/api/tags`);
  });

  it("devrait signaler Ollama injoignable sans lever", async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await listOllamaModels(BASE, { fetch: impl })).toEqual({ reachable: false, models: [] });
  });

  it("devrait abandonner vite (sonde courte) sans lever", async () => {
    const { impl } = fakeFetch(
      (_c, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
        }),
    );
    const started = Date.now();
    expect(await listOllamaModels(BASE, { fetch: impl, timeoutMs: 30 })).toEqual({ reachable: false, models: [] });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("devrait ignorer une réponse mal formée", async () => {
    const { impl } = fakeFetch(() => json(200, { models: "nope" }));
    expect(await listOllamaModels(BASE, { fetch: impl })).toEqual({ reachable: false, models: [] });
  });
});

describe("createOllamaProvider — correctifs de revue", () => {
  const hang = (_call: Call, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
    });

  // B3 : la classification du jour J ne doit pas attendre le délai d'un deck (10 min).
  it("devrait appliquer un délai propre et court à la classification", async () => {
    const { impl } = fakeFetch(hang);
    const ai = createOllamaProvider({ baseUrl: BASE, model: "m", fetch: impl, timeoutMs: 60_000, classifyTimeoutMs: 30, production: false });
    const started = Date.now();
    await expect(ai.classify(PROMPT)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  // B4 : un 502 HTML (proxy) est une indisponibilité, pas une « réponse inexploitable ».
  it("devrait traiter une erreur HTTP non JSON comme une indisponibilité", async () => {
    const { ai } = provider(() => new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("devrait encore reconnaître un modèle absent (404 JSON)", async () => {
    const { ai } = provider(() => json(404, { error: "model \"mistral\" not found, try pulling it first" }));
    const error = (await ai.classify(PROMPT).catch((e: unknown) => e)) as AiUnavailableError;
    expect(error.userMessage).toBe("Le modèle mistral n'est pas installé : ollama pull mistral");
  });

  // S5 : taille de réponse bornée.
  it("devrait refuser une réponse annoncée au-delà de 2 Mo (content-length)", async () => {
    const body = JSON.stringify({ message: { role: "assistant", content: "{}" }, done: true, done_reason: "stop" });
    const { ai } = provider(
      () => new Response(body, { status: 200, headers: { "content-type": "application/json", "content-length": String(3 * 1024 * 1024) } }),
    );
    // Réponse non diffusée (reconnaissance) : la taille annoncée suffit à la refuser.
    await expect(ai.classify(PROMPT)).rejects.toBeInstanceOf(AiInvalidOutputError);
  });

  it("devrait refuser un deck diffusé dont le texte assemblé dépasse 2 Mo", async () => {
    const piece = JSON.stringify({ message: { content: "x".repeat(200 * 1024) }, done: false });
    let sent = 0;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 40) controller.close();
        else controller.enqueue(encoder.encode(`${piece}\n`));
      },
    });
    const { ai } = provider(() => new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
    expect(sent).toBeLessThan(40);
  });

  it("devrait couper une réponse en flux qui dépasse 2 Mo sans content-length", async () => {
    const chunk = new TextEncoder().encode("x".repeat(256 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 40) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { ai } = provider(() => new Response(stream, { status: 200, headers: { "content-type": "application/json" } }));
    await expect(ai.generateDeck(PROMPT, HINTS)).rejects.toBeInstanceOf(AiInvalidOutputError);
    expect(sent).toBeLessThan(40);
  });

  // S3 : concurrence globale bornée.
  it("devrait refuser après une attente bornée quand le modèle local est occupé", async () => {
    const { createSemaphore } = await import("@/server/concurrency");
    const semaphore = createSemaphore(1);
    const { impl } = fakeFetch(hang);
    const busy = createOllamaProvider({ baseUrl: BASE, model: "m", fetch: impl, timeoutMs: 200, semaphore, queueWaitMs: 20, production: false });
    const first = busy.generateDeck(PROMPT, HINTS).catch((e: unknown) => e);
    const error = (await busy.classify(PROMPT).catch((e: unknown) => e)) as AiUnavailableError;
    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.userMessage).toBe("Le modèle local est occupé, réessayez dans un instant.");
    expect(error.refundable).toBe(true);
    await first;
  });

  // B8 : seule une indisponibilité de connexion (rien n'a été calculé) est remboursable.
  it("devrait marquer remboursable une connexion refusée, pas un délai dépassé ni une 5xx", async () => {
    const refused = provider(() => {
      throw new TypeError("fetch failed");
    });
    expect(((await refused.ai.classify(PROMPT).catch((e: unknown) => e)) as AiUnavailableError).refundable).toBe(true);
    const failing = provider(() => json(500, { error: "oom" }));
    expect(((await failing.ai.classify(PROMPT).catch((e: unknown) => e)) as AiUnavailableError).refundable).toBe(false);
    const { impl } = fakeFetch(hang);
    const slow = createOllamaProvider({ baseUrl: BASE, model: "m", fetch: impl, classifyTimeoutMs: 20, production: false });
    expect(((await slow.classify(PROMPT).catch((e: unknown) => e)) as AiUnavailableError).refundable).toBe(false);
  });
});

describe("listOllamaModels — taille bornée", () => {
  it("devrait ignorer une liste démesurée", async () => {
    const { impl } = fakeFetch(
      () =>
        new Response(JSON.stringify({ models: [{ name: "mistral:latest" }] }), {
          status: 200,
          headers: { "content-type": "application/json", "content-length": String(5 * 1024 * 1024) },
        }),
    );
    expect(await listOllamaModels(BASE, { fetch: impl })).toEqual({ reachable: false, models: [] });
  });
});
