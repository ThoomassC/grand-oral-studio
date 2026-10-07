import { AiUnavailableError } from "../errors";
import { DEFAULT_MODEL } from "./model";

/**
 * Choix de la source IA pour un utilisateur (fonction pure, testable sans base) :
 *   1. clé de l'utilisateur (toujours prioritaire, y compris si AI_PROVIDER=mock :
 *      l'utilisateur a explicitement fourni une clé vérifiée) ;
 *   2. AI_PROVIDER=mock → mock (choix explicite de l'opérateur, dev/tests) ;
 *   3. clé serveur ANTHROPIC_API_KEY ;
 *   4. aucune (y compris en dev : le moteur gratuit prend le relais, cf. engine.ts).
 */

export type AiSource = "user" | "server" | "mock" | "none";

type Env = Partial<Record<string, string | undefined>>;

export function serverApiKey(env: Env): string | null {
  return env.ANTHROPIC_API_KEY?.trim() || null;
}

export function configuredModel(env: Env): string {
  return env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

export const AI_PROVIDER_ERROR = "AI_PROVIDER doit valoir anthropic ou mock ; pour Ollama, utilisez OLLAMA_BASE_URL.";

function aiProviderChoice(env: Env): "mock" | "anthropic" | null {
  const choice = env.AI_PROVIDER?.trim().toLowerCase();
  if (!choice) return null;
  if (choice === "mock" || choice === "anthropic") return choice;
  throw new AiUnavailableError(`AI_PROVIDER inconnu : « ${choice} »`, {
    userMessage: "Le service de génération est mal configuré. Choisissez Sans IA dans la Rédaction IA ou réessayez plus tard.",
  });
}

/**
 * AI_PROVIDER=mock (dev/tests), sans lever : une valeur invalide vaut « pas de
 * mock » ici (le démarrage la refuse déjà, cf. assertAiProviderEnv).
 */
export function mockForced(env: Env): boolean {
  return env.AI_PROVIDER?.trim().toLowerCase() === "mock";
}

/** Validation au démarrage (next.config.ts) : échoue tôt, avec un message explicite. */
export function assertAiProviderEnv(env: Env): void {
  try {
    aiProviderChoice(env);
  } catch {
    throw new Error(AI_PROVIDER_ERROR);
  }
}

/** Comme resolveAiSource, sans lever : une configuration invalide vaut « aucune clé ». */
export function safeResolveAiSource(input: { hasUserKey: boolean; env: Env }, onError?: (error: unknown) => void): AiSource {
  try {
    return resolveAiSource(input);
  } catch (error) {
    onError?.(error);
    return "none";
  }
}

export function resolveAiSource(input: { hasUserKey: boolean; env: Env }): AiSource {
  const { env } = input;
  const choice = aiProviderChoice(env);
  if (input.hasUserKey) return "user";
  if (choice === "mock") return "mock";
  if (serverApiKey(env)) return "server";
  return "none";
}
