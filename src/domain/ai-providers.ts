import { z } from "zod";

/**
 * Fournisseurs d'IA « cloud » proposés pour la rédaction, et ce que l'interface en
 * montre. Module sûr côté client : AUCUNE URL d'API, aucun nom de variable
 * d'environnement, aucun motif de clé (ce qui touche au réseau ou aux secrets vit
 * dans src/server/ai/catalog.ts).
 *
 * Identifiants de modèles : liste fermée (le serveur refuse tout autre modèle).
 * Seul celui de Claude est celui que l'application utilise déjà
 * (src/server/ai/model.ts) ; les autres sont à confirmer par GET /models — non
 * vérifié le 2026-10-07.
 */

export const CLOUD_PROVIDERS = ["claude", "mistral", "gemini", "openai"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export const CloudProviderSchema = z.enum(CLOUD_PROVIDERS, { error: "Fournisseur d'IA inconnu." });

/** Rédacteurs possibles : un fournisseur cloud, un modèle local (Ollama) ou Sans IA. */
export const ENGINE_IDS = [...CLOUD_PROVIDERS, "ollama", "free"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** Origine de la clé d'un fournisseur cloud : la sienne, ou la clé d'équipe du serveur. */
export const KEY_SOURCES = ["user", "server"] as const;
export type KeySource = (typeof KEY_SOURCES)[number];
export const KeySourceSchema = z.enum(KEY_SOURCES, { error: "Origine de clé inconnue." });

export interface ProviderModel {
  id: string;
  label: string;
}

/** Ce que devient un texte envoyé au fournisseur (mentions factuelles, sans promesse). */
export interface ProviderDataPolicy {
  hosting: string;
  euHosted: boolean;
  training: string;
  retention: string;
}

export interface ProviderInfo {
  id: CloudProvider;
  /** Nom du rédacteur (« Claude », « Mistral »…). */
  label: string;
  /** Nom de l'API dans les messages (« votre clé API Anthropic »). */
  apiName: string;
  /** Page où créer une clé. */
  consoleUrl: string;
  /** Aide à la saisie, sans jamais citer une vraie clé. */
  keyHint: string;
  models: readonly ProviderModel[];
  defaultModel: string;
  data: ProviderDataPolicy;
  /** Un palier gratuit existe chez le fournisseur. */
  free: boolean;
}

export const PROVIDER_INFO: Readonly<Record<CloudProvider, ProviderInfo>> = {
  claude: {
    id: "claude",
    label: "Claude",
    apiName: "Anthropic",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "Commence par « sk-ant- ». Un abonnement Claude.ai ne donne pas de crédits API : l'API est payante à l'usage.",
    // Identifiant utilisé par l'application depuis la 1.1 (src/server/ai/model.ts).
    models: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }],
    defaultModel: "claude-opus-5-5",
    data: {
      hosting: "Anthropic, traitement hors de l'Union européenne.",
      euHosted: false,
      training: "API payante : pas d'entraînement sur vos données par défaut.",
      retention: "Durée de conservation fixée par la politique de confidentialité d'Anthropic.",
    },
    free: false,
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    apiName: "Mistral",
    consoleUrl: "https://console.mistral.ai/api-keys",
    keyHint: "Clé de la console Mistral (lettres et chiffres). Le palier gratuit « Experiment » suffit pour essayer.",
    // À confirmer par GET /models — non vérifié le 2026-10-07.
    models: [
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "mistral-medium-latest", label: "Mistral Medium" },
      { id: "mistral-small-latest", label: "Mistral Small" },
    ],
    defaultModel: "mistral-large-latest",
    data: {
      hosting: "Mistral AI, hébergé dans l'Union européenne.",
      euHosted: true,
      training:
        "Palier gratuit « Experiment » : entraînement sur vos données activé par défaut, désactivable dans l'Admin Console (Privacy).",
      retention: "Durée de conservation fixée par la politique de confidentialité de Mistral AI.",
    },
    free: true,
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    apiName: "Gemini",
    consoleUrl: "https://aistudio.google.com/apikey",
    keyHint: "Commence par « AIza ». Une clé créée dans Google AI Studio donne accès au palier gratuit.",
    // À confirmer par GET /models — non vérifié le 2026-10-07.
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    ],
    defaultModel: "gemini-2.5-flash",
    data: {
      hosting: "Google, traitement hors de l'Union européenne.",
      euHosted: false,
      training: "Palier gratuit : pas d'entraînement sur vos données pour les utilisateurs de l'Espace économique européen.",
      retention: "Durée de conservation fixée par les conditions de l'API Gemini.",
    },
    free: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    apiName: "OpenAI",
    consoleUrl: "https://platform.openai.com/api-keys",
    keyHint: "Commence par « sk- ». Un abonnement ChatGPT ne donne pas de crédits API : l'API est payante à l'usage.",
    // À confirmer par GET /models — non vérifié le 2026-10-07.
    models: [
      { id: "gpt-5-mini", label: "GPT-5 mini" },
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-4.1", label: "GPT-4.1" },
    ],
    defaultModel: "gpt-5-mini",
    data: {
      hosting: "OpenAI, traitement hors de l'Union européenne.",
      euHosted: false,
      training: "API payante : pas d'entraînement sur vos données par défaut.",
      retention: "Durée de conservation fixée par la politique de confidentialité d'OpenAI.",
    },
    free: false,
  },
};

export function isCloudProvider(value: unknown): value is CloudProvider {
  return typeof value === "string" && (CLOUD_PROVIDERS as readonly string[]).includes(value);
}

/** Le modèle fait partie de la liste fermée du fournisseur. */
export function isKnownModel(provider: CloudProvider, model: string): boolean {
  return PROVIDER_INFO[provider].models.some((m) => m.id === model);
}

/** Libellé d'un rédacteur (fournisseur cloud, Ollama, Sans IA, démo). */
export function engineLabel(engine: EngineId | "mock"): string {
  if (isCloudProvider(engine)) return PROVIDER_INFO[engine].label;
  return engine === "ollama" ? "Ollama" : engine === "free" ? "Sans IA" : "Démo";
}
