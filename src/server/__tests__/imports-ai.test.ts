import { describe, expect, it } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import { createAnthropicProvider } from "@/server/ai/anthropic";
import { createMockProvider } from "@/server/ai/mock";
import { createOllamaProvider } from "@/server/ai/ollama";
import { AiKeyRejectedError, AiUnavailableError } from "@/server/errors";

/** `fetch` factice qui capture le corps envoyé et répond par un message JSON (aucun réseau). */
function anthropicFetch(text: string, status = 200) {
  const bodies: Record<string, unknown>[] = [];
  const impl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (status >= 400) {
      return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "x" } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    const message = {
      id: "msg",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl, bodies };
}

const DRAFT = { name: "Maison", colors: { primary: "#112233" }, headingFont: "Georgia", bodyFont: "Arial" };

describe("Anthropic — deduceBrand (vision)", () => {
  it("devrait envoyer un bloc document PDF base64 puis la consigne, avec un format JSON", async () => {
    const { impl, bodies } = anthropicFetch(JSON.stringify(DRAFT));
    const ai = createAnthropicProvider({ apiKey: "k", fetch: impl, keySource: "user" });
    const draft = await ai.deduceBrand!({ kind: "pdf", base64: "JVBERi0=" });
    expect(draft).toMatchObject(DRAFT);
    const messages = bodies[0]!.messages as { role: string; content: { type: string; source?: { type: string; media_type: string; data: string } }[] }[];
    const content = messages[0]!.content;
    expect(content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } });
    expect(content[1]!.type).toBe("text");
    expect((bodies[0]!.output_config as { format: { type: string } }).format.type).toBe("json_schema");
  });

  it("devrait envoyer un bloc image pour un PNG ou un JPEG", async () => {
    const { impl, bodies } = anthropicFetch(JSON.stringify(DRAFT));
    const ai = createAnthropicProvider({ apiKey: "k", fetch: impl });
    await ai.deduceBrand!({ kind: "jpeg", base64: "/9j/" });
    const content = (bodies[0]!.messages as { content: { type: string; source: { media_type: string } }[] }[])[0]!.content;
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
  });

  it("devrait traduire une clé refusée comme pour une génération", async () => {
    const { impl } = anthropicFetch("", 401);
    const ai = createAnthropicProvider({ apiKey: "k", fetch: impl, keySource: "user" });
    await expect(ai.deduceBrand!({ kind: "png", base64: "iVBO" })).rejects.toBeInstanceOf(AiKeyRejectedError);
  });
});

describe("Anthropic — draftTemplate", () => {
  it("devrait renvoyer le brouillon permissif (sans le valider strictement)", async () => {
    const raw = { durationMinutes: 20, sections: [{ title: "Intro", slides: 1 }] };
    const { impl, bodies } = anthropicFetch(JSON.stringify(raw));
    const ai = createAnthropicProvider({ apiKey: "k", fetch: impl });
    expect(await ai.draftTemplate!({ system: "s", user: "u" }, { text: "t", base: defaultTemplate() })).toEqual(raw);
    expect(bodies[0]!.system).toBe("s");
  });
});

describe("Ollama — draftTemplate", () => {
  it("devrait appeler /api/chat avec un schéma JSON et renvoyer le brouillon", async () => {
    const raw = { durationMinutes: 15 };
    const calls: string[] = [];
    const impl = async (input: string | URL | Request): Promise<Response> => {
      calls.push(String(input));
      return new Response(JSON.stringify({ message: { role: "assistant", content: JSON.stringify(raw) }, done: true, done_reason: "stop" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const ai = createOllamaProvider({ baseUrl: "http://localhost:11434", model: "m", fetch: impl, production: false });
    expect(await ai.draftTemplate!({ system: "s", user: "u" }, { text: "t", base: defaultTemplate() })).toEqual(raw);
    expect(calls).toEqual(["http://localhost:11434/api/chat"]);
    expect(ai.deduceBrand).toBeUndefined();
  });

  it("devrait signaler Ollama injoignable", async () => {
    const impl = async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    };
    const ai = createOllamaProvider({ baseUrl: "http://localhost:11434", model: "m", fetch: impl, production: false });
    await expect(ai.draftTemplate!({ system: "s", user: "u" }, { text: "t", base: defaultTemplate() })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });
});

describe("mock — imports", () => {
  it("devrait produire un brouillon de gabarit déterministe à partir du texte", async () => {
    const ai = createMockProvider();
    const draft = await ai.draftTemplate!({ system: "", user: "" }, { text: "Durée : 15 min", base: defaultTemplate() });
    expect(draft.durationMinutes).toBe(15);
  });

  it("devrait produire une charte simulée", async () => {
    const draft = await createMockProvider().deduceBrand!({ kind: "png", base64: "x" });
    expect(draft.name).toBeTruthy();
  });
});
