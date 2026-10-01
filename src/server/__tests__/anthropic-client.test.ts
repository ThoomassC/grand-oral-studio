import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicApiUrl, createAnthropicClient } from "@/server/ai/anthropic-client";
import { verifyAnthropicKey } from "@/server/ai/verify-key";

/**
 * S2 : le SDK lit ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN et ANTHROPIC_CUSTOM_HEADERS
 * dans l'environnement du processus. Les clés des utilisateurs ne doivent partir
 * que vers l'API Anthropic configurée par l'app, sans bearer ni en-têtes du serveur.
 */

afterEach(() => vi.unstubAllEnvs());

function hostileEnv() {
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://evil.example");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "server-bearer-token");
  vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "X-Leak: secret\nX-Other: 2");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server-key");
}

function capture() {
  const calls: { url: string; headers: Headers }[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { impl, calls };
}

describe("createAnthropicClient", () => {
  it("devrait cibler api.anthropic.com avec la seule clé fournie, malgré l'environnement du processus", async () => {
    hostileEnv();
    const { impl, calls } = capture();
    const client = createAnthropicClient({ apiKey: "sk-ant-user-key", fetch: impl, env: {} });
    await client.models.list({ limit: 1 });
    expect(new URL(calls[0]!.url).origin).toBe("https://api.anthropic.com");
    const h = calls[0]!.headers;
    expect(h.get("x-api-key")).toBe("sk-ant-user-key");
    expect(h.get("authorization")).toBeNull();
    expect(h.get("x-leak")).toBeNull();
    expect(h.get("x-other")).toBeNull();
  });

  it("devrait suivre ANTHROPIC_API_URL (variable propre à l'app) quand elle est en https", async () => {
    const { impl, calls } = capture();
    const client = createAnthropicClient({ apiKey: "k", fetch: impl, env: { ANTHROPIC_API_URL: "https://proxy.interne/" } });
    await client.models.list({ limit: 1 });
    expect(new URL(calls[0]!.url).origin).toBe("https://proxy.interne");
  });

  it("devrait aussi protéger la vérification de clé", async () => {
    hostileEnv();
    const { impl, calls } = capture();
    expect(await verifyAnthropicKey("sk-ant-user-key", { fetch: impl })).toEqual({ ok: true });
    expect(new URL(calls[0]!.url).origin).toBe("https://api.anthropic.com");
    expect(calls[0]!.headers.get("authorization")).toBeNull();
    expect(calls[0]!.headers.get("x-leak")).toBeNull();
  });
});

describe("anthropicApiUrl", () => {
  it.each([
    [undefined, "https://api.anthropic.com"],
    ["", "https://api.anthropic.com"],
    ["https://proxy.interne:8443/", "https://proxy.interne:8443"],
  ])("ANTHROPIC_API_URL=%o → %s", (value, expected) => {
    expect(anthropicApiUrl({ ANTHROPIC_API_URL: value })).toBe(expected);
  });

  it.each(["http://api.anthropic.com", "file:///etc/passwd", "pas une url", "https://u:p@proxy.interne"])(
    "devrait refuser %s (https sans identifiants exigé)",
    (value) => {
      expect(() => anthropicApiUrl({ ANTHROPIC_API_URL: value })).toThrow(/ANTHROPIC_API_URL/);
    },
  );
});
