/**
 * Lecture bornée des réponses HTTP des fournisseurs IA (Ollama, API
 * OpenAI-compatibles) : on ne charge jamais en mémoire une réponse démesurée.
 */

/** Taille maximale lue d'une réponse (un deck JSON fait quelques dizaines de Ko). */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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

