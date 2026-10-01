import { describe, expect, it } from "vitest";
import { verifyAnthropicKey } from "@/server/ai/verify-key";

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
