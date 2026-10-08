import { z } from "zod";
import { ENGINE_IDS, KEY_SOURCES, type EngineId, type KeySource } from "@/domain/ai-providers";
import type { EngineSelection } from "../ai/engine";
import type { SecretBox } from "../crypto/secret-box";
import { db } from "../db/client";
import type { Logger } from "../logger";
import { parseStored } from "../validation";
import { deleteCredential, listCredentials, loadCredential, type CredentialMeta } from "./ai-credentials";

/**
 * Préférences IA d'un utilisateur (user_ai_settings : rédacteur choisi, origine
 * de la clé, modèle Ollama) et vue d'ensemble de ses connexions (clés par
 * fournisseur : src/server/repo/ai-credentials.ts). Toutes les requêtes sont
 * filtrées par `userId` (clé primaire) : un utilisateur n'atteint jamais la
 * ligne d'un autre.
 *
 * Les colonnes historiques anthropicKey* ne sont plus lues ni écrites ici (cf.
 * ai-credentials.ts, qui les vide à la suppression de la connexion Claude).
 */

type Env = Partial<Record<string, string | undefined>>;

/** @deprecated Vue 1.1 de la clé Claude ; utiliser `connections`. */
export interface UserAiKeyMeta {
  last4: string;
  keyVersion: number;
  updatedAt: Date;
}

export interface UserAiPrefs {
  selection: EngineSelection;
  ollamaModel: string | null;
  /** Clés personnelles enregistrées (métadonnées seules), triées par fournisseur. */
  connections: CredentialMeta[];
  /** @deprecated Connexion Claude au format 1.1 ; utiliser `connections`. */
  key: UserAiKeyMeta | null;
  /** @deprecated Utiliser `selection.engine`. */
  engine: EngineId | null;
}

const EngineColumnSchema = z.enum(ENGINE_IDS).nullable();
const KeySourceColumnSchema = z.enum(KEY_SOURCES).nullable();

/** Préférences et métadonnées affichables (jamais le chiffré). Deux lectures indépendantes, en parallèle. */
export async function findUserAiPrefs(userId: string): Promise<UserAiPrefs> {
  const [row, connections] = await Promise.all([
    db().userAiSettings.findUnique({ where: { userId }, select: { engine: true, keySource: true, ollamaModel: true } }),
    listCredentials(userId),
  ]);
  const engine = parseStored(EngineColumnSchema, row?.engine ?? null, "UserAiSettings.engine", userId);
  const keySource = parseStored(KeySourceColumnSchema, row?.keySource ?? null, "UserAiSettings.keySource", userId);
  const claude = connections.find((c) => c.provider === "claude");
  return {
    selection: { engine, keySource },
    ollamaModel: row?.ollamaModel ?? null,
    connections,
    key: claude ? { last4: claude.last4, keyVersion: claude.keyVersion, updatedAt: claude.updatedAt } : null,
    engine,
  };
}

/** @deprecated Métadonnées de la clé Claude (jamais le chiffré), null si aucune clé. */
export async function findUserAiKeyMeta(userId: string): Promise<UserAiKeyMeta | null> {
  return (await findUserAiPrefs(userId)).key;
}

/**
 * Enregistre le rédacteur choisi (upsert : la ligne peut ne pas exister). Le
 * modèle Ollama n'est remplacé que s'il est fourni : revenir à Ollama plus tard
 * retrouve le dernier modèle choisi. `keySource` est remis à NULL hors fournisseur cloud.
 */
export async function saveUserSelection(
  userId: string,
  /** engine null : pas de préférence (rédacteur par défaut, cf. src/server/ai/engine.ts). */
  selection: { engine: EngineId | null; keySource: KeySource | null },
  ollamaModel?: string,
): Promise<void> {
  const keySource =
    selection.engine === null || selection.engine === "ollama" || selection.engine === "free" ? null : selection.keySource;
  const data = { engine: selection.engine, keySource, ...(ollamaModel !== undefined ? { ollamaModel } : {}) };
  await db().userAiSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data, select: { userId: true } });
}

/** @deprecated Choix 1.1 (keySource NULL : clé personnelle sinon clé d'équipe). Utiliser saveUserSelection. */
export async function saveUserEngine(userId: string, engine: EngineId, ollamaModel?: string): Promise<void> {
  await saveUserSelection(userId, { engine, keySource: null }, ollamaModel);
}

/** @deprecated Suppression de la connexion Claude (cf. deleteCredential). */
export async function deleteUserAiKey(userId: string): Promise<boolean> {
  return deleteCredential(userId, "claude");
}

/** @deprecated Clé Claude en clair de l'utilisateur, ou null (cf. loadCredential). */
export async function loadUserApiKey(
  userId: string,
  options: { env?: Env; log: Logger; box?: SecretBox },
): Promise<string | null> {
  return (await loadCredential(userId, "claude", options))?.apiKey ?? null;
}
