import { AiUnavailableError } from "../errors";
import { createLogger } from "../logger";
import { createAnthropicProvider } from "./anthropic";
import { createMockProvider } from "./mock";
import type { AiProvider } from "./types";

export type { AiProvider, ClassifyHints, DeckHints } from "./types";

/**
 * Sélection du fournisseur :
 * - AI_PROVIDER=mock → mock ;
 * - sinon, avec ANTHROPIC_API_KEY → Anthropic (modèle AI_MODEL, défaut claude-opus-5-5) ;
 * - sans clé : mock hors production, erreur claire en production.
 */

let cached: AiProvider | null = null;
const log = createLogger({ component: "ai" });

export function resolveAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const choice = env.AI_PROVIDER?.trim().toLowerCase();
  if (choice === "mock") return createMockProvider();
  if (choice && choice !== "anthropic") {
    throw new AiUnavailableError(`AI_PROVIDER inconnu : « ${choice} » (attendu : mock | anthropic)`);
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) return createAnthropicProvider({ apiKey, model: env.AI_MODEL?.trim() || undefined });
  if (env.NODE_ENV === "production" || choice === "anthropic") {
    log.error("ai.misconfigured", { reason: "ANTHROPIC_API_KEY absente", nodeEnv: env.NODE_ENV });
    throw new AiUnavailableError("ANTHROPIC_API_KEY manquante : impossible d'utiliser le fournisseur Anthropic.");
  }
  log.warn("ai.mock_fallback", { reason: "ANTHROPIC_API_KEY absente hors production" });
  return createMockProvider();
}

export function getAiProvider(): AiProvider {
  cached ??= resolveAiProvider();
  return cached;
}
