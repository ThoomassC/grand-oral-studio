import { z } from "zod";
import { CLOUD_PROVIDERS, type CloudProvider, type KeySource } from "@/domain/ai-providers";
import { loadSecretBoxFromEnv, SecretBoxError, type SecretBox } from "../crypto/secret-box";
import { db } from "../db/client";
import { AiKeyUnreadableError, ConfigurationError } from "../errors";
import type { Logger } from "../logger";
import { parseStored } from "../validation";

/**
 * Clés API des fournisseurs cloud (table user_ai_credential), une par
 * (utilisateur, fournisseur). Toutes les requêtes sont filtrées par `userId`
 * (début de la clé primaire) : un utilisateur n'atteint jamais la clé d'un autre.
 *
 * Chiffrement : src/server/crypto/secret-box.ts, AAD `userId:provider`
 * (aadScheme 2) — un chiffré recopié sur une autre ligne (autre utilisateur OU
 * autre fournisseur) ne se déchiffre pas. Les clés Claude recopiées de la 1.1 par
 * la migration v120_expand portent aadScheme 1 (AAD = userId) : elles sont lues
 * puis rechiffrées en aadScheme 2 (mise à jour conditionnelle, comme la rotation
 * de la clé maître).
 *
 * Les colonnes historiques anthropicKey* de user_ai_settings ne sont plus ni
 * lues ni écrites, sauf pour être VIDÉES à l'enregistrement d'une nouvelle clé
 * Claude et à la suppression de la connexion Claude (la copie 1.1 ne survit ni
 * à un remplacement ni à une suppression). Elles disparaissent en 1.3 (contract).
 *
 * Seul ce module manipule une clé en clair, et uniquement en mémoire.
 */

type Env = Partial<Record<string, string | undefined>>;

export type AadScheme = 1 | 2;

export interface CredentialMeta {
  provider: CloudProvider;
  last4: string;
  /** null : modèle par défaut du catalogue. */
  model: string | null;
  keyVersion: number;
  aadScheme: AadScheme;
  /** null : jamais vérifiée depuis la 1.2 (clé recopiée de la 1.1). */
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoadedCredential {
  apiKey: string;
  model: string | null;
}

/** AAD du schéma 2 : lie le chiffré à l'utilisateur ET au fournisseur. */
export function credentialAad(userId: string, provider: CloudProvider): string {
  return `${userId}:${provider}`;
}

function aadFor(scheme: AadScheme, userId: string, provider: CloudProvider): string {
  return scheme === 1 ? userId : credentialAad(userId, provider);
}

const META_SELECT = {
  provider: true,
  last4: true,
  model: true,
  keyVersion: true,
  aadScheme: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const StoredMetaSchema = z.object({
  provider: z.enum(CLOUD_PROVIDERS),
  last4: z.string(),
  model: z.string().nullable(),
  keyVersion: z.number().int(),
  aadScheme: z.union([z.literal(1), z.literal(2)]),
  verifiedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

function toMeta(row: unknown, userId: string): CredentialMeta {
  return parseStored(StoredMetaSchema, row, "UserAiCredential", userId);
}

const where = (userId: string, provider: CloudProvider) => ({ userId_provider: { userId, provider } });

/** Connexions de l'utilisateur (métadonnées seules, jamais le chiffré), triées par fournisseur. */
export async function listCredentials(userId: string): Promise<CredentialMeta[]> {
  const rows = await db().userAiCredential.findMany({ where: { userId }, select: META_SELECT, orderBy: { provider: "asc" } });
  return rows.map((row) => toMeta(row, userId));
}

export async function findCredential(userId: string, provider: CloudProvider): Promise<CredentialMeta | null> {
  const row = await db().userAiCredential.findUnique({ where: where(userId, provider), select: META_SELECT });
  return row ? toMeta(row, userId) : null;
}

export interface SaveCredentialInput {
  apiKey: string;
  model: string | null;
  verifiedAt: Date;
}

/**
 * Chiffre et enregistre la clé (INSERT … ON CONFLICT DO UPDATE sur la clé
 * primaire : rejouable, dernier gagnant). Avec `select`, choisit aussi ce
 * rédacteur dans la MÊME transaction (jamais « clé enregistrée mais rédacteur
 * non choisi »). Pour Claude, vide aussi les colonnes historiques anthropicKey*
 * dans cette transaction. Le modèle Ollama enregistré est conservé.
 */
export async function saveCredential(
  userId: string,
  provider: CloudProvider,
  input: SaveCredentialInput,
  box: SecretBox,
  options: { select?: { engine: CloudProvider; keySource: KeySource } } = {},
): Promise<CredentialMeta> {
  const sealed = box.seal(input.apiKey, credentialAad(userId, provider));
  const data = {
    ciphertext: sealed.ciphertext,
    keyVersion: sealed.keyVersion,
    aadScheme: 2,
    last4: input.apiKey.slice(-4),
    model: input.model,
    verifiedAt: input.verifiedAt,
  };
  const client = db();
  const upsert = client.userAiCredential.upsert({
    where: where(userId, provider),
    create: { userId, provider, ...data },
    update: data,
    select: META_SELECT,
  });
  // Nouvelle clé Claude : la copie 1.1 (colonnes historiques) ne doit pas survivre à son remplacement.
  const legacy = provider === "claude" ? [clearLegacyClaudeKey(client, userId)] : [];
  const selection = options.select
    ? [
        client.userAiSettings.upsert({
          where: { userId },
          create: { userId, ...options.select },
          update: options.select,
          select: { userId: true },
        }),
      ]
    : [];
  if (legacy.length === 0 && selection.length === 0) return toMeta(await upsert, userId);
  const [row] = await client.$transaction([upsert, ...legacy, ...selection]);
  return toMeta(row, userId);
}

/** Vide les colonnes historiques anthropicKey* de user_ai_settings (no-op si déjà vides). */
function clearLegacyClaudeKey(client: Pick<ReturnType<typeof db>, "userAiSettings">, userId: string) {
  return client.userAiSettings.updateMany({
    where: { userId, anthropicKeyCiphertext: { not: null } },
    data: { anthropicKeyCiphertext: null, anthropicKeyLast4: null, keyVersion: null },
  });
}

/** Change le modèle d'une connexion existante ; false si la connexion n'existe pas. */
export async function setCredentialModel(userId: string, provider: CloudProvider, model: string | null): Promise<boolean> {
  const { count } = await db().userAiCredential.updateMany({ where: { userId, provider }, data: { model } });
  return count > 0;
}

/** Date de la dernière vérification réussie (test de connexion). */
export async function markCredentialVerified(userId: string, provider: CloudProvider, at: Date): Promise<void> {
  await db().userAiCredential.updateMany({ where: { userId, provider }, data: { verifiedAt: at } });
}

/**
 * Supprime la connexion (idempotent ; true si quelque chose a été supprimé),
 * dans UNE transaction :
 *  - la ligne user_ai_credential ;
 *  - pour Claude, les colonnes historiques anthropicKey* de user_ai_settings ;
 *  - si la sélection utilisait CETTE clé personnelle (même fournisseur, keySource
 *    'user' ou NULL), retour au choix par défaut (engine et keySource NULL). Une
 *    sélection sur la clé d'équipe est conservée.
 */
export async function deleteCredential(userId: string, provider: CloudProvider): Promise<boolean> {
  return db().$transaction(async (tx) => {
    const { count: removed } = await tx.userAiCredential.deleteMany({ where: { userId, provider } });
    let legacy = 0;
    if (provider === "claude") ({ count: legacy } = await clearLegacyClaudeKey(tx, userId));
    const existed = removed > 0 || legacy > 0;
    if (existed) {
      await tx.userAiSettings.updateMany({
        where: { userId, engine: provider, OR: [{ keySource: "user" }, { keySource: null }] },
        data: { engine: null, keySource: null },
      });
    }
    return existed;
  });
}

/**
 * Clé en clair et modèle, ou null sans connexion.
 *
 * - Ligne indéchiffrable (clé maître absente, changée sans rotation, valeur
 *   altérée ou recopiée) → AiKeyUnreadableError, journalisée : jamais de bascule
 *   silencieuse sur une autre clé.
 * - Ancienne clé maître et/ou aadScheme 1 → rechiffrée avec la clé maître
 *   courante en aadScheme 2, par mise à jour CONDITIONNELLE (si la ligne a changé
 *   entre-temps, on ne l'écrase pas). Un échec du rechiffrement est journalisé
 *   (`ai_key.rewrap_failed`) : la clé déchiffrée est quand même renvoyée.
 */
export async function loadCredential(
  userId: string,
  provider: CloudProvider,
  options: { env?: Env; log: Logger; box?: SecretBox },
): Promise<LoadedCredential | null> {
  const row = await db().userAiCredential.findUnique({
    where: where(userId, provider),
    select: { ciphertext: true, keyVersion: true, aadScheme: true, model: true },
  });
  if (!row) return null;
  const scheme: AadScheme = row.aadScheme === 1 ? 1 : 2;

  let box: SecretBox;
  let apiKey: string;
  try {
    box = options.box ?? loadSecretBoxFromEnv(options.env ?? process.env);
    apiKey = box.open(row.ciphertext, aadFor(scheme, userId, provider), row.keyVersion);
  } catch (error) {
    if (error instanceof SecretBoxError || error instanceof ConfigurationError) {
      options.log.error("ai_key.unreadable", { provider, reason: error.message, keyVersion: row.keyVersion, aadScheme: scheme });
      throw new AiKeyUnreadableError();
    }
    throw error;
  }

  if (scheme === 1 || box.isStale(row.keyVersion)) {
    // Opportuniste : un échec (base, chiffrement) est journalisé et n'empêche pas d'utiliser la clé lue ;
    // la ligne sera rechiffrée à une prochaine lecture.
    try {
      const sealed = box.seal(apiKey, credentialAad(userId, provider));
      const { count } = await db().userAiCredential.updateMany({
        where: { userId, provider, ciphertext: row.ciphertext, keyVersion: row.keyVersion, aadScheme: row.aadScheme },
        data: { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, aadScheme: 2 },
      });
      options.log.info("ai_key.rewrapped", {
        provider,
        from: row.keyVersion,
        to: sealed.keyVersion,
        fromScheme: scheme,
        toScheme: 2,
        applied: count > 0,
      });
    } catch (error) {
      options.log.error("ai_key.rewrap_failed", { provider, from: row.keyVersion, fromScheme: scheme, error });
    }
  }
  return { apiKey, model: row.model };
}
