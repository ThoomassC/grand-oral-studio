import { AiKeyRequiredError, EngineUnavailableError } from "../errors";
import type { AiBilling } from "../rate-limit";
import { resolveAiSource, safeResolveAiSource } from "./resolve";

/**
 * Moteur de rédaction d'un utilisateur (fonctions pures, sans réseau ni base).
 *
 * Sans préférence : Claude si une clé (utilisateur ou serveur) existe, sinon le
 * moteur gratuit — y compris en production. Le mock n'apparaît qu'avec
 * AI_PROVIDER=mock (dev/tests), à la place de la clé serveur.
 *
 * Préférence enregistrée mais inutilisable → erreur qui renvoie vers la Configuration IA,
 * jamais de bascule silencieuse vers un autre moteur.
 */

export const ENGINES = ["claude", "ollama", "free"] as const;
export type Engine = (typeof ENGINES)[number];
export type EffectiveEngine = Engine | "mock";

type Env = Partial<Record<string, string | undefined>>;

export interface EngineInputs {
  selected: Engine | null;
  hasUserKey: boolean;
  ollamaModel: string | null;
  env: Env;
}

export type EnginePlan =
  | { engine: "claude"; keySource: "user" | "server" }
  | { engine: "mock" }
  | { engine: "ollama"; baseUrl: string; model: string }
  | { engine: "free" };

/**
 * URL d'Ollama fixée par le serveur (jamais par l'utilisateur : SSRF). http(s)
 * uniquement, sans identifiants, sans chemin ni barre finale ; sinon null.
 */
export function ollamaBaseUrl(env: Env): string | null {
  const raw = env.OLLAMA_BASE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** Ne lève pas : une configuration AI_PROVIDER invalide rend Claude indisponible. */
export function claudeAvailable(input: Pick<EngineInputs, "hasUserKey" | "env">): boolean {
  return safeResolveAiSource(input) !== "none";
}

export function planEngine(input: EngineInputs): EnginePlan {
  // La source Claude n'est résolue (et AI_PROVIDER lu) que si Claude est en jeu :
  // une mauvaise configuration Claude ne doit pas bloquer les moteurs gratuit et Ollama.
  const claude = (): EnginePlan | null => {
    const claudeSource = resolveAiSource(input);
    return claudeSource === "mock" ? { engine: "mock" } : claudeSource === "none" ? null : { engine: "claude", keySource: claudeSource };
  };

  switch (input.selected) {
    case null:
      return claude() ?? { engine: "free" };
    case "free":
      return { engine: "free" };
    case "claude": {
      const plan = claude();
      if (!plan) throw new AiKeyRequiredError();
      return plan;
    }
    case "ollama": {
      const baseUrl = ollamaBaseUrl(input.env);
      if (!baseUrl) {
        throw new EngineUnavailableError("Ollama n'est pas configuré sur ce serveur : choisissez un autre moteur dans la Configuration IA.");
      }
      if (!input.ollamaModel) throw new EngineUnavailableError("Choisissez un modèle Ollama dans la Configuration IA.");
      return { engine: "ollama", baseUrl, model: input.ollamaModel };
    }
  }
}

/** Moteur qui sera tenté (sans lever) : pour l'affichage dans la Configuration IA. */
export function effectiveEngine(input: EngineInputs): EffectiveEngine {
  if (input.selected === "ollama" || input.selected === "free") return input.selected;
  const source = safeResolveAiSource(input);
  if (source === "mock") return "mock";
  if (input.selected === "claude") return "claude";
  return source === "none" ? "free" : "claude";
}

export function billingFor(plan: Exclude<EnginePlan, { engine: "free" }>): AiBilling {
  if (plan.engine === "claude") return plan.keySource === "user" ? "user" : "server";
  if (plan.engine === "ollama") return "local";
  return "server";
}
