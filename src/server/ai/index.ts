import type { CloudProvider, KeySource } from "@/domain/ai-providers";
import type { SecretBox } from "../crypto/secret-box";
import { AiKeyRequiredError } from "../errors";
import { createLogger, type Logger } from "../logger";
import type { AiBilling } from "../rate-limit";
import { loadCredential, type LoadedCredential } from "../repo/ai-credentials";
import { findUserAiPrefs } from "../repo/ai-settings";
import { createAnthropicProvider } from "./anthropic";
import { modelFor, teamKey } from "./catalog";
import { billingFor, planEngine, type EngineInputs, type EngineOverride, type EnginePlan } from "./engine";
import { createMockProvider } from "./mock";
import { createOllamaProvider } from "./ollama";
import { createOpenAiCompatibleProvider } from "./openai-compatible";
import { createProviderCache } from "./provider-cache";
import { serverApiKey } from "./resolve";
import type { AiProvider } from "./types";

export type {
  AiProvider,
  CallOptions,
  ClassifyHints,
  DeckHints,
  JuryQuestionsHints,
  SlideHints,
  StructuredRequest,
  StructuredResult,
} from "./types";
export type { AiSource } from "./resolve";
export type { EffectiveEngine, Engine, EngineId, EngineOverride, EngineSelection, KeySource } from "./engine";

/**
 * Rédacteur d'un utilisateur, prêt à l'emploi (cf. engine.ts pour les règles).
 * Une clé personnelle n'est déchiffrée que si ELLE est effectivement retenue.
 *
 * Un client par (fournisseur, source, modèle, clé) — cache LRU borné, indexé
 * par hash : jamais de client partagé entre deux clés différentes.
 */

type Env = Partial<Record<string, string | undefined>>;

export type ResolvedEngine =
  | { engine: "free" }
  | { engine: "mock" | "ollama"; provider: AiProvider; billing: AiBilling }
  | { engine: CloudProvider; provider: AiProvider; billing: AiBilling; keySource: KeySource; model: string };

export interface GetEngineOptions {
  /** Choix ponctuel (repli en un clic), prioritaire sur la sélection enregistrée ; jamais de bascule s'il est inutilisable. */
  override?: EngineOverride | null;
  env?: Env;
  log?: Logger;
  box?: SecretBox;
  /** Injection pour les tests : contourne le cache. */
  fetch?: typeof fetch;
  /** Injection pour les tests (course entre lecture des préférences et déchiffrement). */
  loadCredential?: typeof loadCredential;
  /** @deprecated Injection 1.1, pour Claude seulement ; utiliser `loadCredential`. */
  loadUserApiKey?: (userId: string, options: { env?: Env; log: Logger; box?: SecretBox }) => Promise<string | null>;
}

const cache = createProviderCache(64);
let mock: AiProvider | null = null;
const baseLog = createLogger({ component: "ai" });

export async function getEngineForUser(userId: string, options: GetEngineOptions = {}): Promise<ResolvedEngine> {
  const env = options.env ?? process.env;
  const log = options.log ?? baseLog;
  const prefs = await findUserAiPrefs(userId);
  const inputs: EngineInputs = {
    selection: prefs.selection,
    override: options.override ?? null,
    connections: prefs.connections.map((c) => c.provider),
    ollamaModel: prefs.ollamaModel,
    env,
  };

  const load = async (provider: CloudProvider): Promise<LoadedCredential | null> => {
    const loadOptions = { env, log, box: options.box };
    if (provider === "claude" && options.loadUserApiKey) {
      const apiKey = await options.loadUserApiKey(userId, loadOptions);
      return apiKey === null ? null : { apiKey, model: prefs.connections.find((c) => c.provider === "claude")?.model ?? null };
    }
    return (options.loadCredential ?? loadCredential)(userId, provider, loadOptions);
  };

  let plan: EnginePlan = planEngine(inputs);
  let own: LoadedCredential | null = null;
  if (plan.engine !== "free" && plan.engine !== "mock" && plan.engine !== "ollama" && plan.keySource === "user") {
    const provider = plan.engine;
    own = await load(provider);
    if (own === null) {
      // Clé supprimée entre les deux lectures : on rejoue la règle comme si elle n'avait jamais existé
      // (keySource NULL hérité → clé d'équipe, sinon erreur ; choix explicite → erreur, jamais de bascule).
      plan = planEngine({ ...inputs, connections: inputs.connections.filter((p) => p !== provider) });
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
    default: {
      const provider = plan.engine;
      const keySource = plan.keySource;
      const apiKey = keySource === "user" ? own?.apiKey : provider === "claude" ? serverApiKey(env) : teamKey(provider, env);
      if (!apiKey) throw new AiKeyRequiredError(provider); // inatteignable : planEngine l'a garanti
      // Clé d'équipe : modèle par défaut (AI_MODEL pour Claude) ; clé personnelle : modèle de la connexion.
      const model = modelFor(provider, keySource === "user" ? (own?.model ?? null) : null, env);
      const create = (): AiProvider =>
        provider === "claude"
          ? createAnthropicProvider({ apiKey, model, keySource, fetch: options.fetch })
          : createOpenAiCompatibleProvider({ provider, apiKey, model, keySource, fetch: options.fetch });
      const instance = options.fetch ? create() : cache.get({ provider, apiKey, model, source: keySource }, create);
      return { engine: provider, provider: instance, billing: billingFor(plan), keySource, model };
    }
  }
}

/** Pour les tests. */
export function clearAiProviderCache(): void {
  cache.clear();
}
