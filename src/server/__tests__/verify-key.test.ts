import { describe, expect, it } from "vitest";
import { verifyAnthropicKey, verifyOpenAiCompatibleKey, verifyProviderKey } from "@/server/ai/verify-key";

/** `fetch` factice : aucune requête réseau réelle. */
function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; method: string; headers: Headers }[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    return respond(url, init);
  };
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const KEY = "sk-ant-api03-test-key-0000";

describe("verifyAnthropicKey", () => {
  it("devrait accepter une clé valide via un appel GET /v1/models sans génération", async () => {
    const { impl, calls } = fakeFetch(() =>
      json(200, { data: [{ id: "claude-opus-5-5", type: "model", display_name: "x", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: null, last_id: null }),
    );
    expect(await verifyAnthropicKey(KEY, { fetch: impl })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toMatch(/\/v1\/models\?limit=1$/);
    expect(calls[0]!.headers.get("x-api-key")).toBe(KEY);
  });

  it.each([401, 403])("devrait signaler une clé refusée (%s) sans nouvelle tentative", async (status) => {
    const { impl, calls } = fakeFetch(() =>
      json(status, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    );
    expect(await verifyAnthropicKey(KEY, { fetch: impl })).toEqual({ ok: false, reason: "rejected" });
    expect(calls).toHaveLength(1);
  });

  it("devrait signaler une API injoignable quand le réseau échoue", async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await verifyAnthropicKey(KEY, { fetch: impl, retryDelayMs: 1 })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("devrait réessayer une fois une 5xx (opération idempotente) puis réussir", async () => {
    let n = 0;
    const { impl, calls } = fakeFetch(() => {
      n += 1;
      return n === 1
        ? json(529, { type: "error", error: { type: "overloaded_error", message: "x" } })
        : json(200, { data: [], has_more: false, first_id: null, last_id: null });
    });
    expect(await verifyAnthropicKey(KEY, { fetch: impl, retryDelayMs: 1 })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("devrait signaler une API injoignable quand les 5xx persistent", async () => {
    const { impl, calls } = fakeFetch(() => json(500, { type: "error", error: { type: "api_error", message: "x" } }));
    expect(await verifyAnthropicKey(KEY, { fetch: impl, retryDelayMs: 1 })).toEqual({ ok: false, reason: "unavailable" });
    expect(calls).toHaveLength(2);
  });

  it("devrait abandonner au-delà du délai imparti", async () => {
    const { impl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    expect(await verifyAnthropicKey(KEY, { fetch: impl, timeoutMs: 30, retryDelayMs: 1 })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("verifyOpenAiCompatibleKey (1.2)", () => {
  function statusFetch(...statuses: (number | Error)[]) {
    const calls: { url: string; auth: string | null; method?: string; redirect?: RequestRedirect }[] = [];
    const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), method: init?.method, redirect: init?.redirect });
      const next = statuses.shift() ?? 500;
      if (next instanceof Error) throw next;
      const body = next === 400 ? { error: { message: "API key not valid. Please pass a valid API key." } } : { data: [] };
      return new Response(JSON.stringify(body), { status: next });
    };
    return { impl, calls };
  }

  it("devrait vérifier par GET {base}/models avec la clé en Bearer, sans suivre de redirection", async () => {
    const f = statusFetch(200);
    expect(await verifyOpenAiCompatibleKey("mistral", "m-key", { fetch: f.impl })).toEqual({ ok: true });
    expect(f.calls).toEqual([{ url: "https://api.mistral.ai/v1/models", auth: "Bearer m-key", method: "GET", redirect: "error" }]);
  });

  it.each([401, 403])("devrait refuser la clé sur %i sans nouvelle tentative", async (status) => {
    const f = statusFetch(status);
    expect(await verifyOpenAiCompatibleKey("openai", "k", { fetch: f.impl, retryDelayMs: 1 })).toEqual({ ok: false, reason: "rejected" });
    expect(f.calls).toHaveLength(1);
  });

  it("devrait reconnaître le 400 « API key not valid » de Gemini", async () => {
    const f = statusFetch(400);
    expect(await verifyOpenAiCompatibleKey("gemini", "k", { fetch: f.impl })).toEqual({ ok: false, reason: "rejected" });
    expect(f.calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
  });

  it("devrait retenter une fois sur panne transitoire (429, 5xx, réseau)", async () => {
    expect(await verifyOpenAiCompatibleKey("openai", "k", { fetch: statusFetch(503, 200).impl, retryDelayMs: 1 })).toEqual({ ok: true });
    expect(await verifyOpenAiCompatibleKey("openai", "k", { fetch: statusFetch(new TypeError("fetch failed"), 200).impl, retryDelayMs: 1 })).toEqual({ ok: true });
    const f = statusFetch(429, 429);
    expect(await verifyOpenAiCompatibleKey("openai", "k", { fetch: f.impl, retryDelayMs: 1 })).toEqual({ ok: false, reason: "unavailable" });
    expect(f.calls).toHaveLength(2);
  });

  it("devrait router un fournisseur OpenAI-compatible depuis verifyProviderKey", async () => {
    const f = statusFetch(401);
    expect(await verifyProviderKey("mistral", "k", { fetch: f.impl })).toEqual({ ok: false, reason: "rejected" });
  });
});
