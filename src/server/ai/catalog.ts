import { CLOUD_PROVIDERS, isKnownModel, PROVIDER_INFO, type CloudProvider, type ProviderInfo } from "@/domain/ai-providers";
import { DEFAULT_ANTHROPIC_API_URL } from "./anthropic-client";
import { configuredModel } from "./resolve";

/**
 * Catalogue SERVEUR des fournisseurs cloud : ce que le client ne voit jamais.
 *
 * Les URL de base sont FIXES (jamais saisies, ni par l'utilisateur ni par une
 * variable d'environnement) : une clé d'utilisateur ne part que vers l'API de
 * son fournisseur (pas de SSRF, pas de fuite de clé vers une autre origine).
 * Claude passe par le SDK Anthropic (src/server/ai/anthropic-client.ts, qui gère
 * lui-même ANTHROPIC_API_URL) ; son `baseUrl` n'est ici qu'indicatif.
 *
 * `structured` : mode de sortie structurée tenté en premier. Les adaptateurs
 * OpenAI-compatibles se replient sur `json_object` (schéma dans le prompt) si le
 * fournisseur refuse `json_schema`. Gemini : json_schema via la couche
 * OpenAI-compatible non vérifié sans clé (le repli couvre un refus).
 */

type Env = Partial<Record<string, string | undefined>>;

export interface ProviderEntry extends ProviderInfo {
  protocol: "anthropic" | "openai-compatible";
  baseUrl: string;
  structured: "json_schema" | "json_object";
  /** Variable d'environnement de la clé d'équipe (facturation « server »). */
  teamKeyEnv: "ANTHROPIC_API_KEY" | "MISTRAL_API_KEY" | "GEMINI_API_KEY" | "OPENAI_API_KEY";
  /** Forme d'une clé (contrôle de saisie seulement ; la validité est vérifiée auprès du fournisseur). */
  keyPattern: RegExp;
  /** Nom du plafond de jetons de sortie dans Chat Completions. */
  maxTokensParam: "max_tokens" | "max_completion_tokens";
}

export const PROVIDER_CATALOG: Readonly<Record<CloudProvider, ProviderEntry>> = Object.freeze({
  claude: {
    ...PROVIDER_INFO.claude,
    protocol: "anthropic",
    baseUrl: DEFAULT_ANTHROPIC_API_URL,
    structured: "json_schema",
    teamKeyEnv: "ANTHROPIC_API_KEY",
    // Même règle que src/domain/api-key.ts (24 à 256 caractères, préfixe sk-ant-).
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{17,249}$/,
    maxTokensParam: "max_tokens",
  },
  mistral: {
    ...PROVIDER_INFO.mistral,
    protocol: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    structured: "json_schema",
    teamKeyEnv: "MISTRAL_API_KEY",
    keyPattern: /^[A-Za-z0-9]{24,128}$/,
    maxTokensParam: "max_tokens",
  },
  gemini: {
    ...PROVIDER_INFO.gemini,
    protocol: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    structured: "json_schema",
    teamKeyEnv: "GEMINI_API_KEY",
    keyPattern: /^AIza[A-Za-z0-9_-]{30,100}$/,
    maxTokensParam: "max_tokens",
  },
  openai: {
    ...PROVIDER_INFO.openai,
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    structured: "json_schema",
    teamKeyEnv: "OPENAI_API_KEY",
    keyPattern: /^sk-[A-Za-z0-9_-]{20,250}$/,
    // Les modèles à raisonnement refusent max_tokens.
    maxTokensParam: "max_completion_tokens",
  },
});

export function apiKeyMatches(provider: CloudProvider, apiKey: string): boolean {
  return PROVIDER_CATALOG[provider].keyPattern.test(apiKey);
}

/** Clé d'équipe du fournisseur (variable du serveur), null si absente ou vide. */
export function teamKey(provider: CloudProvider, env: Env): string | null {
  return env[PROVIDER_CATALOG[provider].teamKeyEnv]?.trim() || null;
}

/** Fournisseurs pour lesquels le serveur fournit une clé d'équipe. */
export function teamKeyProviders(env: Env): CloudProvider[] {
  return CLOUD_PROVIDERS.filter((p) => teamKey(p, env) !== null);
}

/**
 * Modèle à utiliser : celui de la connexion s'il appartient à la liste fermée,
 * sinon le défaut (pour Claude : AI_MODEL, comme en 1.1).
 */
export function modelFor(provider: CloudProvider, stored: string | null, env: Env): string {
  if (stored && isKnownModel(provider, stored)) return stored;
  return provider === "claude" ? configuredModel(env) : PROVIDER_CATALOG[provider].defaultModel;
}
