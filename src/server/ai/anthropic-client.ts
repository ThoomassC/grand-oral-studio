import Anthropic from "@anthropic-ai/sdk";

/**
 * Seule fabrique de clients Anthropic de l'application.
 *
 * Le SDK lit ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_CUSTOM_HEADERS et
 * ANTHROPIC_LOG dans l'environnement DU PROCESSUS. Ces variables peuvent être
 * posées par l'outillage qui lance le serveur : on ne veut ni envoyer la clé d'un
 * utilisateur vers une autre URL, ni y joindre un bearer ou des en-têtes du
 * serveur, ni journaliser les requêtes. D'où :
 *   - baseURL explicite : ANTHROPIC_API_URL (variable propre à l'app, https,
 *     sans identifiants), défaut https://api.anthropic.com ;
 *   - authToken: null, et chaque en-tête de ANTHROPIC_CUSTOM_HEADERS neutralisé ;
 *   - logLevel explicite ;
 *   - un `fetch` qui refuse toute autre origine et retire `authorization`.
 */

export const DEFAULT_ANTHROPIC_API_URL = "https://api.anthropic.com";

type Env = Partial<Record<string, string | undefined>>;

/** Lève (erreur de configuration) si ANTHROPIC_API_URL n'est pas une origine https sans identifiants. */
export function anthropicApiUrl(env: Env): string {
  const raw = env.ANTHROPIC_API_URL?.trim();
  if (!raw) return DEFAULT_ANTHROPIC_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ANTHROPIC_API_URL invalide : URL https attendue.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("ANTHROPIC_API_URL invalide : https sans identifiants attendu.");
  }
  return url.origin;
}

/** Noms d'en-têtes que le SDK ajouterait depuis ANTHROPIC_CUSTOM_HEADERS. */
function processCustomHeaderNames(): string[] {
  const raw = process.env.ANTHROPIC_CUSTOM_HEADERS;
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.slice(0, Math.max(0, line.indexOf(":"))).trim())
    .filter((name) => name.length > 0);
}

export interface AnthropicClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  timeout?: number;
  /** Environnement de l'app (ANTHROPIC_API_URL) ; défaut process.env. */
  env?: Env;
}

export function createAnthropicClient(options: AnthropicClientOptions): Anthropic {
  const baseURL = anthropicApiUrl(options.env ?? process.env);
  const origin = new URL(baseURL).origin;
  const inner = options.fetch ?? fetch;

  const guardedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error("Requête Anthropic refusée : origine inattendue.");
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    return inner(input, { ...init, headers });
  };

  const neutralHeaders: Record<string, null> = { Authorization: null };
  for (const name of processCustomHeaderNames()) neutralHeaders[name] = null;

  return new Anthropic({
    apiKey: options.apiKey,
    authToken: null,
    baseURL,
    defaultHeaders: neutralHeaders,
    fetch: guardedFetch,
    maxRetries: options.maxRetries ?? 0,
    timeout: options.timeout,
    logLevel: "warn",
  });
}
