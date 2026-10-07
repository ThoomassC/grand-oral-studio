import { z } from "zod";
import { AnthropicApiKeySchema, SaveApiKeyInputSchema } from "@/domain/api-key";
import {
  CLOUD_PROVIDERS,
  CloudProviderSchema,
  engineLabel,
  isCloudProvider,
  isKnownModel,
  KeySourceSchema,
  PROVIDER_INFO,
  type CloudProvider,
} from "@/domain/ai-providers";
import { apiKeyMatches, modelFor, teamKeyProviders } from "../ai/catalog";
import { claudeAvailable, effectiveEngine, ollamaBaseUrl, safePlanEngine, teamAvailable, type EngineInputs } from "../ai/engine";
import type { OllamaModels } from "../ai/ollama";
import { configuredModel, resolveAiSource, safeResolveAiSource, serverApiKey } from "../ai/resolve";
import type { KeyCheck } from "../ai/verify-key";
import { loadSecretBoxFromEnv, type SecretBox } from "../crypto/secret-box";
import { AiKeyRejectedError, AiKeyRequiredError, AiUnavailableError, isAppError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeApiKeyVerifyQuota } from "../rate-limit";
import {
  deleteCredential,
  findCredential,
  loadCredential,
  markCredentialVerified,
  saveCredential,
  setCredentialModel,
} from "../repo/ai-credentials";
import { findUserAiPrefs, saveUserEngine, saveUserSelection, type UserAiPrefs } from "../repo/ai-settings";
import type { AiConnectionView, AiSettingsView, AiWriterState, WriterView } from "../repo/types";
import { parseInput } from "../validation";

/**
 * Logique métier des réglages IA (connexions par fournisseur, choix du
 * rédacteur), indépendante de Next et de HTTP. L'appelant fournit
 * l'environnement, la vérification de clé (réseau, injectable) et le logger.
 * Une clé en clair ne sort jamais d'ici : ni valeur de retour, ni journal, ni
 * message d'erreur.
 */

type Env = Partial<Record<string, string | undefined>>;

function consoleHost(provider: CloudProvider): string {
  return new URL(PROVIDER_INFO[provider].consoleUrl).host;
}

export function keyRejectedMessage(provider: CloudProvider): string {
  return `Cette clé est refusée par ${PROVIDER_INFO[provider].apiName}. Vérifiez-la ou créez-en une nouvelle sur ${consoleHost(provider)}.`;
}

export const KEY_REJECTED_MESSAGE = keyRejectedMessage("claude");
export const KEY_CHECK_UNAVAILABLE_MESSAGE = "Impossible de vérifier la clé pour le moment. Réessayez.";

function checkUnavailable(): AiUnavailableError {
  return new AiUnavailableError("vérification de clé : API injoignable", { userMessage: KEY_CHECK_UNAVAILABLE_MESSAGE });
}

// ---------------------------------------------------------------------------
// Connexions (une clé par fournisseur)
// ---------------------------------------------------------------------------

export interface ConnectionDeps {
  env: Env;
  log: Logger;
  /** Vérification réelle de la clé auprès du fournisseur, sans génération (réseau, injectable). */
  verifyKey: (provider: CloudProvider, apiKey: string) => Promise<KeyCheck>;
  /** Injection pour les tests ; défaut : clé maître lue dans `env`. */
  box?: SecretBox;
}

const ModelSchema = z.string().trim().min(1, "Choisissez un modèle.").max(200, "Nom de modèle trop long.");

export const ConnectProviderInputSchema = z
  .object({
    provider: CloudProviderSchema,
    apiKey: z
      .string({ error: "Saisissez votre clé API." })
      .trim()
      .min(1, "Saisissez votre clé API.")
      .max(256, "Cette clé est trop longue : vérifiez que vous n'avez copié que la clé."),
    /** null/absent : modèle par défaut du catalogue. */
    model: ModelSchema.nullish(),
    /** true : choisit aussi ce rédacteur (sur cette clé), dans la même écriture. */
    activate: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "claude") {
      // Mêmes messages que le champ de la 1.1 (validation partagée avec le front).
      const checked = AnthropicApiKeySchema.safeParse(value.apiKey);
      if (!checked.success) ctx.addIssue({ code: "custom", path: ["apiKey"], message: checked.error.issues[0]!.message });
    } else if (!apiKeyMatches(value.provider, value.apiKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: `Ce n'est pas une clé API ${PROVIDER_INFO[value.provider].apiName} valide. ${PROVIDER_INFO[value.provider].keyHint}`,
      });
    }
    if (value.model && !isKnownModel(value.provider, value.model)) {
      ctx.addIssue({ code: "custom", path: ["model"], message: `Modèle inconnu pour ${PROVIDER_INFO[value.provider].label}.` });
    }
  });
export type ConnectProviderInput = z.input<typeof ConnectProviderInputSchema>;

export const ProviderInputSchema = z.object({ provider: CloudProviderSchema });
export type ProviderInput = z.input<typeof ProviderInputSchema>;

export const ConnectionModelInputSchema = z
  .object({ provider: CloudProviderSchema, model: ModelSchema.nullable() })
  .superRefine((value, ctx) => {
    if (value.model && !isKnownModel(value.provider, value.model)) {
      ctx.addIssue({ code: "custom", path: ["model"], message: `Modèle inconnu pour ${PROVIDER_INFO[value.provider].label}.` });
    }
  });
export type ConnectionModelInput = z.input<typeof ConnectionModelInputSchema>;

/**
 * « Vérifier et enregistrer » une clé : format → clé maître (échec immédiat,
 * avant tout appel réseau) → quota de vérification → vérification réseau (hors
 * transaction) → écriture unique (upsert, et choix du rédacteur si `activate`).
 * Clé refusée ou invérifiable : rien n'est écrit.
 */
export async function connectProvider(
  userId: string,
  input: unknown,
  deps: ConnectionDeps,
): Promise<{ provider: CloudProvider; last4: string; model: string }> {
  const parsed = parseInput(ConnectProviderInputSchema, input);
  const { provider, apiKey } = parsed;
  const box = deps.box ?? loadSecretBoxFromEnv(deps.env);
  await consumeApiKeyVerifyQuota(userId);

  const check = await deps.verifyKey(provider, apiKey);
  if (!check.ok) {
    deps.log.info("ai_key.verify_failed", { provider, reason: check.reason });
    if (check.reason === "rejected") {
      const message = keyRejectedMessage(provider);
      throw new ValidationError(message, { apiKey: [message] });
    }
    throw checkUnavailable();
  }

  const saved = await saveCredential(
    userId,
    provider,
    { apiKey, model: parsed.model ?? null, verifiedAt: new Date() },
    box,
    parsed.activate ? { select: { engine: provider, keySource: "user" } } : {},
  );
  deps.log.info("ai_key.connected", { provider, last4: saved.last4, keyVersion: saved.keyVersion, activated: parsed.activate === true });
  return { provider, last4: saved.last4, model: modelFor(provider, saved.model, deps.env) };
}

/**
 * Revérifie la clé personnelle d'un fournisseur (sans génération) et note la
 * date de vérification. Clé refusée → AiKeyRejectedError (erreur attendue).
 */
export async function testConnection(
  userId: string,
  input: unknown,
  deps: ConnectionDeps,
): Promise<{ provider: CloudProvider; model: string; verifiedAt: string }> {
  const { provider } = parseInput(ProviderInputSchema, input);
  const stored = await loadCredential(userId, provider, { env: deps.env, log: deps.log, box: deps.box });
  if (!stored) throw new AiKeyRequiredError(provider);
  await consumeApiKeyVerifyQuota(userId);
  const check = await deps.verifyKey(provider, stored.apiKey);
  if (!check.ok) {
    deps.log.info("ai_key.test_failed", { provider, reason: check.reason });
    if (check.reason === "unavailable") throw checkUnavailable();
    throw new AiKeyRejectedError({ provider });
  }
  const verifiedAt = new Date();
  await markCredentialVerified(userId, provider, verifiedAt);
  return { provider, model: modelFor(provider, stored.model, deps.env), verifiedAt: verifiedAt.toISOString() };
}

/** Supprime la clé d'un fournisseur (idempotent ; pour Claude, vide aussi les colonnes 1.1). */
export async function deleteConnection(userId: string, input: unknown, deps: { log: Logger }): Promise<void> {
  const { provider } = parseInput(ProviderInputSchema, input);
  const deleted = await deleteCredential(userId, provider);
  deps.log.info("ai_key.deleted", { provider, existed: deleted });
}

/** Change le modèle utilisé avec une clé personnelle (null : défaut du catalogue). */
export async function setConnectionModel(userId: string, input: unknown, deps: { log: Logger }): Promise<void> {
  const { provider, model } = parseInput(ConnectionModelInputSchema, input);
  if (!(await setCredentialModel(userId, provider, model))) {
    const message = `Connectez d'abord ${PROVIDER_INFO[provider].label} avec votre clé API.`;
    throw new ValidationError(message, { provider: [message] });
  }
  deps.log.info("ai_key.model_saved", { provider, model });
}

// ---------------------------------------------------------------------------
// Choix du rédacteur
// ---------------------------------------------------------------------------

/** Nom de modèle Ollama : forme seule ici ; l'appartenance à la liste installée est vérifiée ensuite. */
const OllamaModelNameSchema = z
  .string()
  .trim()
  .min(1, "Choisissez un modèle Ollama.")
  .max(200, "Nom de modèle trop long.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Nom de modèle Ollama invalide.");

const [firstCloud, ...otherClouds] = CLOUD_PROVIDERS.map((engine) =>
  z.object({ engine: z.literal(engine), keySource: KeySourceSchema }),
);

export const SelectWriterInputSchema = z.discriminatedUnion(
  "engine",
  [
    z.object({ engine: z.literal("free") }),
    z.object({ engine: z.literal("ollama"), ollamaModel: OllamaModelNameSchema }),
    firstCloud!,
    ...otherClouds,
  ],
  { error: "Rédacteur inconnu." },
);
export type SelectWriterInput = z.input<typeof SelectWriterInputSchema>;

export interface AiSettingsViewDeps {
  env: Env;
  /** Journal de la mauvaise configuration éventuelle (AI_PROVIDER). */
  log?: Logger;
  /** Sonde d'Ollama (réseau, injectable) ; ne doit jamais lever. */
  listOllamaModels: (baseUrl: string) => Promise<OllamaModels>;
}

async function checkOllama(model: string, deps: AiSettingsViewDeps): Promise<void> {
  const baseUrl = ollamaBaseUrl(deps.env);
  if (!baseUrl) {
    const message = "Le modèle local n'est pas proposé sur ce serveur.";
    throw new ValidationError(message, { engine: [message] });
  }
  const { reachable, models } = await deps.listOllamaModels(baseUrl);
  // Messages pour l'utilisateur, jamais pour l'administrateur : les commandes sont dans le README.
  if (!reachable) {
    throw new AiUnavailableError("ollama: injoignable", { userMessage: "Le modèle local ne répond pas pour le moment. Réessayez plus tard." });
  }
  if (!models.includes(model)) {
    const message = "Ce modèle n'est pas installé sur le serveur.";
    throw new ValidationError(message, { ollamaModel: [message] });
  }
}

/**
 * Choisit le rédacteur, après vérification qu'il est utilisable : clé
 * personnelle enregistrée, clé d'équipe présente sur le serveur, ou Ollama
 * configuré, joignable et modèle installé. « Clé d'équipe » = keySource 'server'.
 */
export async function selectWriter(userId: string, input: unknown, deps: AiSettingsViewDeps & { log: Logger }): Promise<void> {
  const parsed = parseInput(SelectWriterInputSchema, input);
  if (parsed.engine === "free") {
    await saveUserSelection(userId, { engine: "free", keySource: null });
  } else if (parsed.engine === "ollama") {
    await checkOllama(parsed.ollamaModel, deps);
    await saveUserSelection(userId, { engine: "ollama", keySource: null }, parsed.ollamaModel);
  } else {
    const { engine: provider, keySource } = parsed;
    const label = PROVIDER_INFO[provider].label;
    if (keySource === "user" && !(await findCredential(userId, provider))) {
      const message = `Connectez d'abord ${label} avec votre clé API.`;
      throw new ValidationError(message, { engine: [message] });
    }
    if (keySource === "server" && !teamAvailable(provider, deps.env)) {
      const message = `Aucune clé d'équipe ${label} n'est proposée sur ce serveur.`;
      throw new ValidationError(message, { keySource: [message] });
    }
    await saveUserSelection(userId, { engine: provider, keySource });
  }
  deps.log.info("ai_engine.saved", { engine: parsed.engine, keySource: "keySource" in parsed ? parsed.keySource : null });
}

// ---------------------------------------------------------------------------
// Vues
// ---------------------------------------------------------------------------

function engineInputs(prefs: UserAiPrefs, env: Env): EngineInputs {
  return {
    selection: prefs.selection,
    connections: prefs.connections.map((c) => c.provider),
    ollamaModel: prefs.ollamaModel,
    env,
  };
}

/** Rédacteur qui sera tenté, sans réseau, sans déchiffrement, sans lever. */
function writerState(prefs: UserAiPrefs, env: Env): AiWriterState {
  const inputs = engineInputs(prefs, env);
  const planned = safePlanEngine(inputs);
  if (!planned.ok) {
    return {
      engine: effectiveEngine(inputs),
      keySource: prefs.selection.keySource,
      model: null,
      ready: false,
      problem: isAppError(planned.error)
        ? planned.error.userMessage
        : "Le service de génération est mal configuré. Choisissez un autre rédacteur dans la Configuration IA.",
    };
  }
  const plan = planned.plan;
  switch (plan.engine) {
    case "free":
      return { engine: "free", keySource: null, model: null, ready: true, problem: null };
    case "mock":
      return { engine: "mock", keySource: null, model: "mock", ready: true, problem: null };
    case "ollama":
      return { engine: "ollama", keySource: null, model: plan.model, ready: true, problem: null };
    default: {
      const own = plan.keySource === "user" ? (prefs.connections.find((c) => c.provider === plan.engine)?.model ?? null) : null;
      return { engine: plan.engine, keySource: plan.keySource, model: modelFor(plan.engine, own, env), ready: true, problem: null };
    }
  }
}

function writerLabel(state: AiWriterState): string {
  const base = engineLabel(state.engine);
  if (isCloudProvider(state.engine) && state.keySource) return `${base} (${state.keySource === "user" ? "votre clé" : "clé d'équipe"})`;
  if (state.engine === "ollama" && state.model) return `${base} · ${state.model}`;
  return base;
}

/** Vue légère du rédacteur (bandeaux) : une lecture en base, aucune sonde réseau. */
export async function getWriterView(userId: string, deps: { env: Env }): Promise<WriterView> {
  const state = writerState(await findUserAiPrefs(userId), deps.env);
  return { ...state, label: writerLabel(state) };
}

function connectionView(prefs: UserAiPrefs, env: Env): AiConnectionView[] {
  return prefs.connections.map((c) => ({
    provider: c.provider,
    last4: c.last4,
    model: modelFor(c.provider, c.model, env),
    defaultModel: c.model === null || !isKnownModel(c.provider, c.model),
    verifiedAt: c.verifiedAt?.toISOString() ?? null,
    updatedAt: c.updatedAt.toISOString(),
  }));
}

const LEGACY_ENGINES = new Set(["claude", "ollama", "free"] as const);
type LegacyEngine = "claude" | "ollama" | "free";
const isLegacy = (engine: string | null): engine is LegacyEngine => engine !== null && LEGACY_ENGINES.has(engine as LegacyEngine);

/** Vue pour la page Configuration IA : aucune donnée secrète, aucun déchiffrement ; ne lève pas si Ollama est arrêté. */
export async function getAiSettingsView(userId: string, deps: AiSettingsViewDeps): Promise<AiSettingsView> {
  const { env } = deps;
  const prefs = await findUserAiPrefs(userId);
  const claude = prefs.connections.find((c) => c.provider === "claude") ?? null;
  const hasUserKey = claude !== null;
  const effectiveSource = safeResolveAiSource({ hasUserKey, env }, (error) =>
    deps.log?.error("ai.misconfigured", { detail: error instanceof AiUnavailableError ? error.detail : String(error) }),
  );
  const baseUrl = ollamaBaseUrl(env);
  const probe = baseUrl ? await deps.listOllamaModels(baseUrl) : { reachable: false, models: [] };
  const ollama = { configured: baseUrl !== null, reachable: probe.reachable, models: probe.models, selectedModel: prefs.ollamaModel };
  const effective = writerState(prefs, env);
  const legacyEffective = effective.engine === "mock" || isLegacy(effective.engine) ? effective.engine : "claude";

  return {
    connections: connectionView(prefs, env),
    team: teamKeyProviders(env),
    selection: prefs.selection,
    effective,
    mock: safeResolveAiSource({ hasUserKey: false, env }) === "mock",
    ollama,
    userKey: { configured: hasUserKey, last4: claude?.last4 ?? null, updatedAt: claude?.updatedAt.toISOString() ?? null },
    effectiveSource,
    model: effectiveSource === "mock" ? "mock" : modelFor("claude", effectiveSource === "user" ? (claude?.model ?? null) : null, env),
    engine: {
      selected: isLegacy(prefs.selection.engine) ? prefs.selection.engine : null,
      effective: legacyEffective,
      available: { claude: claudeAvailable({ hasUserKey, env }), ollama, free: true },
    },
  };
}

// ---------------------------------------------------------------------------
// Enveloppes 1.1 (écran actuel, jusqu'au lot UI)
// ---------------------------------------------------------------------------

/** @deprecated Dépendances 1.1 : vérification de clé Anthropic seulement. */
export interface AiSettingsDeps {
  env: Env;
  log: Logger;
  verifyKey: (apiKey: string) => Promise<KeyCheck>;
  box?: SecretBox;
}

/**
 * @deprecated « Vérifier et activer » 1.1 : connectProvider("claude") qui choisit
 * aussi Claude sur cette clé, en une seule écriture.
 */
export async function activateClaudeWithKey(userId: string, input: unknown, deps: AiSettingsDeps): Promise<{ last4: string }> {
  const { apiKey } = parseInput(SaveApiKeyInputSchema, input);
  const result = await connectProvider(
    userId,
    { provider: "claude", apiKey, activate: true },
    { env: deps.env, log: deps.log, box: deps.box, verifyKey: (_provider, key) => deps.verifyKey(key) },
  );
  deps.log.info("ai_key.activated", { last4: result.last4 });
  return { last4: result.last4 };
}

/** @deprecated Suppression de la connexion Claude. */
export async function deleteApiKey(userId: string, deps: Pick<AiSettingsDeps, "log">): Promise<void> {
  await deleteConnection(userId, { provider: "claude" }, deps);
}

/** @deprecated Revérifie la clé que Claude utiliserait (la sienne, sinon celle du serveur). */
export async function testEffectiveKey(userId: string, deps: AiSettingsDeps): Promise<{ source: "user" | "server"; model: string }> {
  const own = await loadCredential(userId, "claude", { env: deps.env, log: deps.log, box: deps.box });
  const source = resolveAiSource({ hasUserKey: own !== null, env: deps.env });
  if (source === "none") throw new AiKeyRequiredError();
  if (source === "mock") {
    throw new ValidationError(
      "Aucune clé API à tester : les générations utilisent le mode simulé. Ajoutez votre clé API Anthropic pour de vrais contenus.",
    );
  }
  const apiKey = source === "user" ? own?.apiKey : serverApiKey(deps.env);
  if (!apiKey) throw new AiKeyRequiredError();

  await consumeApiKeyVerifyQuota(userId);
  const check = await deps.verifyKey(apiKey);
  if (!check.ok) {
    if (check.reason === "unavailable") throw checkUnavailable();
    if (source === "user") throw new AiKeyRejectedError();
    deps.log.error("ai.server_key_rejected", {});
    throw new AiUnavailableError("clé serveur refusée par Anthropic");
  }
  if (source === "user") await markCredentialVerified(userId, "claude", new Date());
  return { source, model: source === "user" ? modelFor("claude", own?.model ?? null, deps.env) : configuredModel(deps.env) };
}

/** @deprecated Choix 1.1 du moteur ("claude" | "ollama" | "free") ; utiliser selectWriter. */
export const SetEngineInputSchema = z.discriminatedUnion(
  "engine",
  [
    z.object({ engine: z.literal("claude") }),
    z.object({ engine: z.literal("free") }),
    z.object({ engine: z.literal("ollama"), ollamaModel: OllamaModelNameSchema }),
  ],
  { error: "Moteur attendu : claude, ollama, free." },
);
export type SetEngineInput = z.input<typeof SetEngineInputSchema>;

/**
 * @deprecated Enregistre le moteur 1.1 : Claude exige une clé (la sienne ou celle du
 * serveur ; keySource NULL = règle 1.1), Ollama exige qu'il soit configuré,
 * joignable, et que le modèle soit installé.
 */
export async function setEngine(userId: string, input: unknown, deps: AiSettingsViewDeps & { log: Logger }): Promise<void> {
  const parsed = parseInput(SetEngineInputSchema, input);
  if (parsed.engine === "claude") {
    const own = await findCredential(userId, "claude");
    if (!claudeAvailable({ hasUserKey: own !== null, env: deps.env })) {
      const message = "Connectez d'abord Claude avec votre clé API Anthropic.";
      throw new ValidationError(message, { engine: [message] });
    }
    await saveUserEngine(userId, "claude");
  } else if (parsed.engine === "ollama") {
    await checkOllama(parsed.ollamaModel, deps);
    await saveUserEngine(userId, "ollama", parsed.ollamaModel);
  } else {
    await saveUserEngine(userId, "free");
  }
  deps.log.info("ai_engine.saved", { engine: parsed.engine });
}
