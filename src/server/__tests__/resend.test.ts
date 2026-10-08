import { afterEach, describe, expect, it, vi } from "vitest";
import { RESEND_API_URL, sendEmail } from "@/server/email/resend";

const CONFIG = { apiKey: "re_secret_key_123", from: "Grand Oral Studio <noreply@exemple.fr>" };
const MESSAGE = {
  to: "eleve@lycee-exemple.fr",
  subject: "Confirmez votre adresse",
  text: "Ouvrez https://app.exemple.fr/api/auth/verify-email?token=jeton-secret",
  html: "<p>Ouvrez le lien</p>",
};

interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
}

function scripted(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error("appel inattendu");
    if (next instanceof Error) throw next;
    return next;
  });
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("sendEmail (Resend)", () => {
  it("devrait poster le message à l'API Resend avec la clé en Bearer et l'expéditeur configuré", async () => {
    const { impl, calls } = scripted([json(200, { id: "msg_1" })]);
    const result = await sendEmail(CONFIG, { ...MESSAGE, idempotencyKey: "verify:abc" }, { fetch: impl });

    expect(result).toEqual({ ok: true, id: "msg_1" });
    expect(RESEND_API_URL).toBe("https://api.resend.com/emails");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://api.resend.com/emails");
    expect(call!.method).toBe("POST");
    expect(call!.headers.get("authorization")).toBe("Bearer re_secret_key_123");
    expect(call!.headers.get("content-type")).toBe("application/json");
    expect(call!.headers.get("idempotency-key")).toBe("verify:abc");
    expect(call!.body).toEqual({
      from: CONFIG.from,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
  });

  it("devrait borner chaque appel par un délai (signal d'abandon)", async () => {
    const impl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const result = await sendEmail(CONFIG, MESSAGE, { fetch: impl, timeoutMs: 20, retryDelayMs: 0 });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("ne devrait pas réessayer un message refusé (4xx)", async () => {
    const { impl, calls } = scripted([json(422, { name: "validation_error", message: "Invalid `to` field" })]);
    const result = await sendEmail(CONFIG, { ...MESSAGE, idempotencyKey: "k" }, { fetch: impl, retryDelayMs: 0 });
    expect(result).toEqual({ ok: false, reason: "rejected", status: 422 });
    expect(calls).toHaveLength(1);
  });

  it("devrait réessayer une panne passagère (5xx, 429, réseau) quand l'envoi porte une clé d'idempotence", async () => {
    const { impl, calls } = scripted([json(503, {}), new TypeError("fetch failed"), json(200, { id: "msg_2" })]);
    const result = await sendEmail(CONFIG, { ...MESSAGE, idempotencyKey: "k" }, { fetch: impl, retryDelayMs: 0 });
    expect(result).toEqual({ ok: true, id: "msg_2" });
    expect(calls).toHaveLength(3);
    // Même clé d'idempotence à chaque tentative : Resend n'envoie qu'un e-mail.
    expect(calls.map((c) => c.headers.get("idempotency-key"))).toEqual(["k", "k", "k"]);
  });

  it("ne devrait pas réessayer sans clé d'idempotence (risque de doublon)", async () => {
    const { impl, calls } = scripted([json(500, {})]);
    const result = await sendEmail(CONFIG, MESSAGE, { fetch: impl, retryDelayMs: 0 });
    expect(result).toEqual({ ok: false, reason: "unavailable", status: 500 });
    expect(calls).toHaveLength(1);
  });

  it("ne devrait jamais lever d'exception, même si toutes les tentatives échouent", async () => {
    const { impl, calls } = scripted([new TypeError("a"), new TypeError("b"), new TypeError("c")]);
    await expect(sendEmail(CONFIG, { ...MESSAGE, idempotencyKey: "k" }, { fetch: impl, retryDelayMs: 0 })).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(calls).toHaveLength(3);
  });

  it("ne devrait journaliser ni la clé, ni le destinataire, ni le contenu (lien à jeton)", async () => {
    const lines: string[] = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    }
    const { impl } = scripted([json(500, { message: "boom re_secret_key_123" }), json(200, { id: "msg_3" })]);
    await sendEmail(CONFIG, { ...MESSAGE, idempotencyKey: "k" }, { fetch: impl, retryDelayMs: 0 });
    const { impl: failing } = scripted([json(422, { message: "bad eleve@lycee-exemple.fr" })]);
    await sendEmail(CONFIG, MESSAGE, { fetch: failing, retryDelayMs: 0 });

    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join("\n");
    for (const secret of ["re_secret_key_123", "eleve@lycee-exemple.fr", "jeton-secret", "Confirmez votre adresse"]) {
      expect(all).not.toContain(secret);
    }
  });
});
