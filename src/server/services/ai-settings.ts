import { apiKeyLast4, SaveApiKeyInputSchema } from "@/domain/api-key";
import { loadSecretBoxFromEnv, type SecretBox } from "../crypto/secret-box";
import { z } from "zod";
import { claudeAvailable, effectiveEngine, ENGINES, ollamaBaseUrl } from "../ai/engine";
import type { OllamaModels } from "../ai/ollama";
import { configuredModel, resolveAiSource, safeResolveAiSource, serverApiKey } from "../ai/resolve";
import type { KeyCheck } from "../ai/verify-key";
import { AiKeyRejectedError, AiKeyRequiredError, AiUnavailableError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeApiKeyVerifyQuota } from "../rate-limit";
import { deleteUserAiKey, findUserAiPrefs, loadUserApiKey, saveUserAiKey, saveUserEngine } from "../repo/ai-settings";
import type { AiSettingsView } from "../repo/types";
import { parseInput } from "../validation";

/**
 * Logique métier des réglages IA, indépendante de Next et de HTTP. L'appelant
 * fournit l'environnement, la vérification de clé (réseau, injectable) et le
 * logger. La clé en clair ne sort jamais d'ici : ni valeur de retour, ni journal,
 * ni message d'erreur.
 */

type Env = Partial<Record<string, string | undefined>>;

export interface AiSettingsDeps {
  env: Env;
  log: Logger;
  verifyKey: (apiKey: string) => Promise<KeyCheck>;
  /** Injection pour les tests ; défaut : clé maître lue dans `env`. */
  box?: SecretBox;
}

export const KEY_REJECTED_MESSAGE =
  "Cette clé est refusée par Anthropic. Vérifiez-la ou créez-en une nouvelle sur console.anthropic.com.";
export const KEY_CHECK_UNAVAILABLE_MESSAGE = "Impossible de vérifier la clé pour le moment. Réessayez.";

function checkUnavailable(): AiUnavailableError {
  return new AiUnavailableError("vérification de clé : API injoignable", { userMessage: KEY_CHECK_UNAVAILABLE_MESSAGE });
}

/**
 * Valide le format, vérifie la clé auprès d'Anthropic, puis l'enregistre
 * chiffrée. Ordre : format → clé maître (échec immédiat, avant tout appel
 * réseau) → quota de vérification → vérification réseau (hors transaction) →
 * écriture unique (upsert).
 */
export async function saveApiKey(userId: string, input: unknown, deps: AiSettingsDeps): Promise<{ last4: string }> {
  const { apiKey } = parseInput(SaveApiKeyInputSchema, input);
  const box = deps.box ?? loadSecretBoxFromEnv(deps.env);
  await consumeApiKeyVerifyQuota(userId);

  const check = await deps.verifyKey(apiKey);
  if (!check.ok) {
    deps.log.info("ai_key.verify_failed", { reason: check.reason });
    if (check.reason === "rejected") throw new ValidationError(KEY_REJECTED_MESSAGE, { apiKey: [KEY_REJECTED_MESSAGE] });
    throw checkUnavailable();
  }

  const saved = await saveUserAiKey(userId, apiKey, apiKeyLast4(apiKey), box);
  deps.log.info("ai_key.saved", { last4: saved.last4, keyVersion: saved.keyVersion });
  return { last4: saved.last4 };
}

export async function deleteApiKey(userId: string, deps: Pick<AiSettingsDeps, "log">): Promise<void> {
  const deleted = await deleteUserAiKey(userId);
  deps.log.info("ai_key.deleted", { existed: deleted });
}

/** Revérifie la clé effectivement utilisée pour les générations de l'utilisateur. */
export async function testEffectiveKey(
  userId: string,
  deps: AiSettingsDeps,
): Promise<{ source: "user" | "server"; model: string }> {
  const userKey = await loadUserApiKey(userId, { env: deps.env, log: deps.log, box: deps.box });
  const source = resolveAiSource({ hasUserKey: userKey !== null, env: deps.env });
  if (source === "none") throw new AiKeyRequiredError();
  if (source === "mock") {
    throw new ValidationError(
      "Aucune clé API à tester : les générations utilisent le mode simulé. Ajoutez votre clé API Anthropic pour de vrais contenus.",
    );
  }
  const apiKey = source === "user" ? userKey : serverApiKey(deps.env);
  if (!apiKey) throw new AiKeyRequiredError();

  await consumeApiKeyVerifyQuota(userId);
  const check = await deps.verifyKey(apiKey);
  if (!check.ok) {
    if (check.reason === "unavailable") throw checkUnavailable();
    if (source === "user") throw new AiKeyRejectedError();
    deps.log.error("ai.server_key_rejected", {});
    throw new AiUnavailableError("clé serveur refusée par Anthropic");
  }
  return { source, model: configuredModel(deps.env) };
}

export interface AiSettingsViewDeps {
  env: Env;
  /** Journal de la mauvaise configuration éventuelle (AI_PROVIDER). */
  log?: Logger;
  /** Sonde d'Ollama (réseau, injectable) ; ne doit jamais lever. */
  listOllamaModels: (baseUrl: string) => Promise<OllamaModels>;
}

/** Vue pour la page Paramètres : aucune donnée secrète, aucun déchiffrement ; ne lève pas si Ollama est arrêté. */
export async function getAiSettingsView(userId: string, deps: AiSettingsViewDeps): Promise<AiSettingsView> {
  const { env } = deps;
  const prefs = await findUserAiPrefs(userId);
  const hasUserKey = prefs.key !== null;
  const effectiveSource = safeResolveAiSource({ hasUserKey, env }, (error) =>
    deps.log?.error("ai.misconfigured", { detail: error instanceof AiUnavailableError ? error.detail : String(error) }),
  );
  const baseUrl = ollamaBaseUrl(env);
  const probe = baseUrl ? await deps.listOllamaModels(baseUrl) : { reachable: false, models: [] };
  return {
    userKey: {
      configured: hasUserKey,
      last4: prefs.key?.last4 ?? null,
      updatedAt: prefs.key?.updatedAt.toISOString() ?? null,
    },
    effectiveSource,
    model: effectiveSource === "mock" ? "mock" : configuredModel(env),
    engine: {
      selected: prefs.engine,
      effective: effectiveEngine({ selected: prefs.engine, hasUserKey, ollamaModel: prefs.ollamaModel, env }),
      available: {
        claude: claudeAvailable({ hasUserKey, env }),
        ollama: { configured: baseUrl !== null, reachable: probe.reachable, models: probe.models, selectedModel: prefs.ollamaModel },
        free: true,
      },
    },
  };
}

/** Nom de modèle Ollama : forme seule ici ; l'appartenance à la liste installée est vérifiée ensuite. */
const OllamaModelNameSchema = z
  .string()
  .trim()
  .min(1, "Choisissez un modèle Ollama.")
  .max(200, "Nom de modèle trop long.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Nom de modèle Ollama invalide.");

export const SetEngineInputSchema = z.discriminatedUnion(
  "engine",
  [
    z.object({ engine: z.literal("claude") }),
    z.object({ engine: z.literal("free") }),
    z.object({ engine: z.literal("ollama"), ollamaModel: OllamaModelNameSchema }),
  ],
  { error: `Moteur attendu : ${ENGINES.join(", ")}.` },
);
export type SetEngineInput = z.input<typeof SetEngineInputSchema>;

/**
 * Enregistre le moteur choisi, après vérification qu'il est utilisable :
 * Claude exige une clé (la sienne ou celle du serveur), Ollama exige qu'il soit
 * configuré, joignable, et que le modèle soit installé.
 */
export async function setEngine(userId: string, input: unknown, deps: AiSettingsViewDeps & { log: Logger }): Promise<void> {
  const parsed = parseInput(SetEngineInputSchema, input);
  if (parsed.engine === "claude") {
    const prefs = await findUserAiPrefs(userId);
    if (!claudeAvailable({ hasUserKey: prefs.key !== null, env: deps.env })) {
      const message = "Ajoutez d'abord votre clé API Anthropic pour utiliser Claude.";
      throw new ValidationError(message, { engine: [message] });
    }
    await saveUserEngine(userId, "claude");
  } else if (parsed.engine === "ollama") {
    const baseUrl = ollamaBaseUrl(deps.env);
    if (!baseUrl) {
      const message = "Ollama n'est pas configuré sur ce serveur.";
      throw new ValidationError(message, { engine: [message] });
    }
    const { reachable, models } = await deps.listOllamaModels(baseUrl);
    if (!reachable) {
      throw new AiUnavailableError("ollama: injoignable", {
        userMessage:
          deps.env.NODE_ENV === "production"
            ? "Le serveur Ollama ne répond pas. Réessayez plus tard."
            : `Ollama ne répond pas à ${baseUrl} : vérifiez qu'il est lancé (ollama serve).`,
      });
    }
    if (!models.includes(parsed.ollamaModel)) {
      const message = `Le modèle ${parsed.ollamaModel} n'est pas installé : ollama pull ${parsed.ollamaModel}`;
      throw new ValidationError(message, { ollamaModel: [message] });
    }
    await saveUserEngine(userId, "ollama", parsed.ollamaModel);
  } else {
    await saveUserEngine(userId, "free");
  }
  deps.log.info("ai_engine.saved", { engine: parsed.engine });
}
