import { z } from "zod";
import { ENGINES, type Engine } from "../ai/engine";
import { db } from "../db/client";
import { loadSecretBoxFromEnv, SecretBoxError, type SecretBox } from "../crypto/secret-box";
import { AiKeyUnreadableError, ConfigurationError } from "../errors";
import type { Logger } from "../logger";
import { parseStored } from "../validation";

/**
 * Stockage de la clé API Anthropic et du moteur de rédaction d'un utilisateur. Toutes les requêtes sont
 * filtrées par `userId` (clé primaire) : un utilisateur n'atteint jamais la ligne
 * d'un autre. Le chiffré est lié à `userId` par l'AAD : copié sur une autre
 * ligne, il ne se déchiffre pas.
 *
 * Seul ce module manipule la clé en clair, et uniquement en mémoire.
 */

type Env = Partial<Record<string, string | undefined>>;

export interface UserAiKeyMeta {
  last4: string;
  keyVersion: number;
  updatedAt: Date;
}

export interface UserAiPrefs {
  /** Métadonnées de la clé, null si aucune clé enregistrée. */
  key: UserAiKeyMeta | null;
  engine: Engine | null;
  ollamaModel: string | null;
}

const EngineColumnSchema = z.enum(ENGINES).nullable();

function readEngine(value: string | null, userId: string): Engine | null {
  return parseStored(EngineColumnSchema, value, "UserAiSettings.engine", userId);
}

function keyMeta(row: { anthropicKeyLast4: string | null; keyVersion: number | null; updatedAt: Date }): UserAiKeyMeta | null {
  return row.anthropicKeyLast4 !== null && row.keyVersion !== null
    ? { last4: row.anthropicKeyLast4, keyVersion: row.keyVersion, updatedAt: row.updatedAt }
    : null;
}

/** Préférences et métadonnées affichables (jamais le chiffré). */
export async function findUserAiPrefs(userId: string): Promise<UserAiPrefs> {
  const row = await db().userAiSettings.findUnique({
    where: { userId },
    select: { anthropicKeyLast4: true, keyVersion: true, updatedAt: true, engine: true, ollamaModel: true },
  });
  if (!row) return { key: null, engine: null, ollamaModel: null };
  return { key: keyMeta(row), engine: readEngine(row.engine, userId), ollamaModel: row.ollamaModel };
}

/** Métadonnées de la clé (jamais le chiffré), null si aucune clé. */
export async function findUserAiKeyMeta(userId: string): Promise<UserAiKeyMeta | null> {
  return (await findUserAiPrefs(userId)).key;
}

/**
 * Enregistre le moteur choisi (upsert : la ligne peut ne pas exister). Le modèle
 * Ollama n'est remplacé que s'il est fourni : revenir à Ollama plus tard retrouve
 * le dernier modèle choisi.
 */
export async function saveUserEngine(userId: string, engine: Engine, ollamaModel?: string): Promise<void> {
  const data = { engine, ...(ollamaModel !== undefined ? { ollamaModel } : {}) };
  await db().userAiSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data, select: { userId: true } });
}

/** Chiffre puis enregistre (INSERT … ON CONFLICT DO UPDATE : rejouable, dernier gagnant). */
export async function saveUserAiKey(
  userId: string,
  apiKey: string,
  last4: string,
  box: SecretBox,
): Promise<UserAiKeyMeta> {
  const sealed = box.seal(apiKey, userId);
  const data = { anthropicKeyCiphertext: sealed.ciphertext, anthropicKeyLast4: last4, keyVersion: sealed.keyVersion };
  const row = await db().userAiSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { anthropicKeyLast4: true, keyVersion: true, updatedAt: true },
  });
  const meta = keyMeta(row);
  if (!meta) throw new Error("saveUserAiKey: ligne sans clé après écriture"); // inatteignable (CHECK)
  return meta;
}

/**
 * Idempotent : supprimer une clé absente n'est pas une erreur. La ligne est
 * conservée (préférence de moteur) ; seules les colonnes de clé sont effacées.
 */
export async function deleteUserAiKey(userId: string): Promise<boolean> {
  const { count } = await db().userAiSettings.updateMany({
    where: { userId, anthropicKeyCiphertext: { not: null } },
    data: { anthropicKeyCiphertext: null, anthropicKeyLast4: null, keyVersion: null },
  });
  return count > 0;
}

/**
 * Clé en clair de l'utilisateur, ou null s'il n'en a pas enregistré.
 *
 * - Ligne présente mais indéchiffrable (clé maître absente, changée sans
 *   rotation, valeur altérée) → AiKeyUnreadableError, journalisée : on ne
 *   bascule pas en silence sur la clé serveur.
 * - Valeur chiffrée avec l'ancienne clé maître → rechiffrée avec la courante
 *   (mise à jour conditionnelle : si la ligne a changé entre-temps, on ne
 *   l'écrase pas).
 */
export async function loadUserApiKey(
  userId: string,
  options: { env?: Env; log: Logger; box?: SecretBox },
): Promise<string | null> {
  const row = await db().userAiSettings.findUnique({
    where: { userId },
    select: { anthropicKeyCiphertext: true, keyVersion: true },
  });
  if (!row || row.anthropicKeyCiphertext === null || row.keyVersion === null) return null;
  const stored = { ciphertext: row.anthropicKeyCiphertext, keyVersion: row.keyVersion };

  let box: SecretBox;
  let apiKey: string;
  try {
    box = options.box ?? loadSecretBoxFromEnv(options.env ?? process.env);
    apiKey = box.open(stored.ciphertext, userId, stored.keyVersion);
  } catch (error) {
    if (error instanceof SecretBoxError || error instanceof ConfigurationError) {
      options.log.error("ai_key.unreadable", { reason: error.message, keyVersion: stored.keyVersion });
      throw new AiKeyUnreadableError();
    }
    throw error;
  }

  if (box.isStale(stored.keyVersion)) {
    const sealed = box.seal(apiKey, userId);
    const { count } = await db().userAiSettings.updateMany({
      where: { userId, keyVersion: stored.keyVersion, anthropicKeyCiphertext: stored.ciphertext },
      data: { anthropicKeyCiphertext: sealed.ciphertext, keyVersion: sealed.keyVersion },
    });
    options.log.info("ai_key.rewrapped", { from: stored.keyVersion, to: sealed.keyVersion, applied: count > 0 });
  }
  return apiKey;
}
