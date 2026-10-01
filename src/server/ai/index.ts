import { createLogger, type Logger } from "../logger";
import type { AiBilling } from "../rate-limit";
import { findUserAiPrefs, loadUserApiKey } from "../repo/ai-settings";
import type { SecretBox } from "../crypto/secret-box";
import { AiKeyRequiredError } from "../errors";
import { createAnthropicProvider } from "./anthropic";
import { billingFor, planEngine } from "./engine";
import { createMockProvider } from "./mock";
import { createOllamaProvider } from "./ollama";
import { createProviderCache } from "./provider-cache";
import { configuredModel, serverApiKey } from "./resolve";
import type { AiProvider } from "./types";

export type { AiProvider, ClassifyHints, DeckHints } from "./types";
export type { AiSource } from "./resolve";
export type { EffectiveEngine, Engine } from "./engine";

/**
 * Moteur de rédaction d'un utilisateur, prêt à l'emploi (cf. engine.ts pour les
 * règles). La clé de l'utilisateur n'est déchiffrée que si le moteur Claude sur
 * SA clé est effectivement retenu.
 *
 * Un client Anthropic par clé (cache LRU borné, indexé par hash) : jamais de
 * client partagé entre deux clés différentes.
 */

type Env = Partial<Record<string, string | undefined>>;

export type ResolvedEngine =
  | { engine: "free" }
  | { engine: "claude" | "ollama" | "mock"; provider: AiProvider; billing: AiBilling };

export interface GetEngineOptions {
  env?: Env;
  log?: Logger;
  box?: SecretBox;
  /** Injection pour les tests : contourne le cache. */
  fetch?: typeof fetch;
  /** Injection pour les tests (course entre lecture des préférences et déchiffrement). */
  loadUserApiKey?: typeof loadUserApiKey;
}

const cache = createProviderCache(64);
let mock: AiProvider | null = null;
const baseLog = createLogger({ component: "ai" });

export async function getEngineForUser(userId: string, options: GetEngineOptions = {}): Promise<ResolvedEngine> {
  const env = options.env ?? process.env;
  const log = options.log ?? baseLog;
  const loadKey = options.loadUserApiKey ?? loadUserApiKey;
  const prefs = await findUserAiPrefs(userId);
  const inputs = { selected: prefs.engine, hasUserKey: prefs.key !== null, ollamaModel: prefs.ollamaModel, env };
  let plan = planEngine(inputs);
  let userKey: string | null = null;
  if (plan.engine === "claude" && plan.keySource === "user") {
    userKey = await loadKey(userId, { env, log, box: options.box });
    if (userKey === null) {
      // Clé supprimée entre les deux lectures : on rejoue la règle comme si elle n'avait jamais existé
      // (sans préférence → clé serveur ou gratuit ; Claude choisi → AiKeyRequiredError).
      plan = planEngine({ ...inputs, hasUserKey: false });
    }
  }

  switch (plan.engine) {
    case "free":
      return { engine: "free" };
    case "mock":
      mock ??= createMockProvider();
      return { engine: "mock", provider: mock, billing: billingFor(plan) };
    case "ollama":
      return {
        engine: "ollama",
        provider: createOllamaProvider({
          baseUrl: plan.baseUrl,
          model: plan.model,
          fetch: options.fetch,
          production: env.NODE_ENV === "production",
        }),
        billing: billingFor(plan),
      };
    case "claude": {
      const apiKey = plan.keySource === "user" ? userKey : serverApiKey(env);
      if (!apiKey) throw new AiKeyRequiredError(); // inatteignable : planEngine l'a garanti

      const model = configuredModel(env);
      const source = plan.keySource;
      const create = () => createAnthropicProvider({ apiKey, model, keySource: source, fetch: options.fetch });
      const provider = options.fetch ? create() : cache.get({ apiKey, model, source }, create);
      return { engine: "claude", provider, billing: billingFor(plan) };
    }
  }
}

/** Pour les tests. */
export function clearAiProviderCache(): void {
  cache.clear();
}
