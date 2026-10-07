import { isCloudProvider, PROVIDER_INFO, type CloudProvider, type EngineId, type KeySource } from "@/domain/ai-providers";
import { AiKeyRequiredError, EngineUnavailableError, type AppError } from "../errors";
import type { AiBilling } from "../rate-limit";
import { teamKey } from "./catalog";
import { resolveAiSource, safeResolveAiSource } from "./resolve";

/**
 * Moteur de rédaction d'un utilisateur (fonctions pures, sans réseau ni base).
 *
 * Entrées : la SÉLECTION enregistrée (moteur + origine de la clé), une SURCHARGE
 * ponctuelle éventuelle (repli en un clic depuis un échec), les CONNEXIONS
 * (fournisseurs pour lesquels l'utilisateur a enregistré une clé) et
 * l'environnement (clés d'équipe, Ollama, AI_PROVIDER).
 *
 * - Sans préférence : règle 1.1 conservée — Claude sur la clé de l'utilisateur,
 *   sinon sur la clé du serveur (ou le mock avec AI_PROVIDER=mock), sinon Sans
 *   IA. Jamais un autre fournisseur implicitement.
 * - Fournisseur choisi avec keySource NULL (sélection héritée de la 1.1) : sa
 *   clé personnelle, sinon la clé d'équipe.
 * - keySource 'user' : la clé personnelle, rien d'autre ; 'server' : la clé
 *   d'équipe (« clé d'équipe »), rien d'autre.
 * - Sélection ou surcharge inutilisable → erreur qui renvoie vers la
 *   Configuration IA, JAMAIS de bascule silencieuse vers un autre moteur.
 */

export { ENGINE_IDS, type EngineId, type KeySource } from "@/domain/ai-providers";

/** @deprecated Moteurs de la 1.1 ; utiliser EngineId. */
export const ENGINES = ["claude", "ollama", "free"] as const;
/** @deprecated Moteurs de la 1.1 ; utiliser EngineId. */
export type Engine = (typeof ENGINES)[number];
export type EffectiveEngine = EngineId | "mock";

type Env = Partial<Record<string, string | undefined>>;

/** Choix enregistré (user_ai_settings.engine / keySource). */
export interface EngineSelection {
  /** null : pas de préférence (règle 1.1). */
  engine: EngineId | null;
  /** null : clé personnelle si elle existe, sinon clé d'équipe (règle 1.1). Sans objet hors fournisseur cloud. */
  keySource: KeySource | null;
}

/** Choix ponctuel pour UNE génération (bouton de repli), prioritaire sur la sélection. */
export type EngineOverride = { engine: "free" } | { engine: CloudProvider; keySource: KeySource };

export interface EngineInputs {
  selection: EngineSelection;
  override?: EngineOverride | null;
  /** Fournisseurs pour lesquels une clé personnelle est enregistrée. */
  connections: readonly CloudProvider[];
  ollamaModel: string | null;
  env: Env;
}

export type EnginePlan =
  | { engine: CloudProvider; keySource: KeySource }
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
export function claudeAvailable(input: { hasUserKey: boolean; env: Env }): boolean {
  return safeResolveAiSource(input) !== "none";
}

/**
 * Clé d'équipe utilisable pour ce fournisseur. Claude : ANTHROPIC_API_KEY, ou le
 * mock imposé par AI_PROVIDER=mock (qui lève si AI_PROVIDER est invalide).
 */
function teamPlan(provider: CloudProvider, env: Env): EnginePlan | null {
  if (provider === "claude") {
    const source = resolveAiSource({ hasUserKey: false, env });
    return source === "mock" ? { engine: "mock" } : source === "server" ? { engine: "claude", keySource: "server" } : null;
  }
  return teamKey(provider, env) ? { engine: provider, keySource: "server" } : null;
}

/** Disponibilité d'une clé d'équipe, sans lever (affichage). */
export function teamAvailable(provider: CloudProvider, env: Env): boolean {
  try {
    return teamPlan(provider, env) !== null;
  } catch {
    return false;
  }
}

function teamUnavailable(provider: CloudProvider): EngineUnavailableError {
  return new EngineUnavailableError(
    `Aucune clé d'équipe ${PROVIDER_INFO[provider].label} n'est configurée sur ce serveur : choisissez votre propre clé ou un autre rédacteur dans la Configuration IA.`,
  );
}

function cloudPlan(provider: CloudProvider, keySource: KeySource | null, input: EngineInputs): EnginePlan {
  const hasOwn = input.connections.includes(provider);
  if (keySource === "user") {
    if (!hasOwn) throw new AiKeyRequiredError(provider);
    return { engine: provider, keySource: "user" };
  }
  if (keySource === "server") {
    const plan = teamPlan(provider, input.env);
    if (!plan) throw teamUnavailable(provider);
    return plan;
  }
  // Règle 1.1 : la sienne d'abord, sinon celle de l'équipe.
  if (hasOwn) return { engine: provider, keySource: "user" };
  const plan = teamPlan(provider, input.env);
  if (!plan) throw new AiKeyRequiredError(provider);
  return plan;
}

export function planEngine(input: EngineInputs): EnginePlan {
  const override = input.override ?? null;
  if (override) {
    return override.engine === "free" ? { engine: "free" } : cloudPlan(override.engine, override.keySource, input);
  }

  const { engine, keySource } = input.selection;
  if (engine === null) {
    // La source Claude n'est résolue (et AI_PROVIDER lu) que si Claude est en jeu :
    // une mauvaise configuration Claude ne doit pas bloquer les moteurs gratuit et Ollama.
    const source = resolveAiSource({ hasUserKey: input.connections.includes("claude"), env: input.env });
    if (source === "mock") return { engine: "mock" };
    return source === "none" ? { engine: "free" } : { engine: "claude", keySource: source };
  }
  if (engine === "free") return { engine: "free" };
  if (engine === "ollama") {
    const baseUrl = ollamaBaseUrl(input.env);
    if (!baseUrl) {
      throw new EngineUnavailableError("Ollama n'est pas configuré sur ce serveur : choisissez un autre moteur dans la Configuration IA.");
    }
    if (!input.ollamaModel) throw new EngineUnavailableError("Choisissez un modèle Ollama dans la Configuration IA.");
    return { engine: "ollama", baseUrl, model: input.ollamaModel };
  }
  return cloudPlan(engine, keySource, input);
}

export type SafePlan = { ok: true; plan: EnginePlan } | { ok: false; error: AppError | Error };

/** Comme planEngine, sans lever (affichage, bandeaux). */
export function safePlanEngine(input: EngineInputs): SafePlan {
  try {
    return { ok: true, plan: planEngine(input) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Moteur qui sera tenté (sans lever) : pour l'affichage. Un fournisseur choisi
 * mais inutilisable reste annoncé (la génération échouera avec un message qui
 * renvoie vers la Configuration IA).
 */
export function effectiveEngine(input: EngineInputs): EffectiveEngine {
  const planned = safePlanEngine(input);
  if (planned.ok) return planned.plan.engine;
  const selected = input.override?.engine ?? input.selection.engine;
  if (selected !== null && (selected === "free" || selected === "ollama" || isCloudProvider(selected))) return selected;
  return "free";
}

export function billingFor(plan: Exclude<EnginePlan, { engine: "free" }>): AiBilling {
  if (plan.engine === "ollama") return "local";
  if (plan.engine === "mock") return "server";
  return plan.keySource === "user" ? "user" : "server";
}
