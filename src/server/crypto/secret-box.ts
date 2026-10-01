import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConfigurationError } from "../errors";

/**
 * Chiffrement authentifié des secrets stockés en base (clés API utilisateur).
 *
 * AES-256-GCM (node:crypto), IV aléatoire de 12 octets, tag de 16 octets, AAD
 * fournie par l'appelant (l'id utilisateur : une valeur copiée sur la ligne d'un
 * autre utilisateur ne se déchiffre pas).
 *
 * Format stocké : `v1:<iv>:<tag>:<ciphertext>` (base64url). « v1 » est la version
 * du FORMAT ; la version de la CLÉ MAÎTRE est stockée à côté (colonne keyVersion)
 * et choisit la clé de déchiffrement.
 *
 * Rotation : SETTINGS_ENCRYPTION_KEY (version SETTINGS_ENCRYPTION_KEY_VERSION,
 * défaut 1) chiffre ; SETTINGS_ENCRYPTION_KEY_PREVIOUS (version - 1), facultative,
 * ne sert qu'à déchiffrer les valeurs pas encore rechiffrées.
 *
 * Aucune erreur ne contient le clair, l'AAD ni la clé.
 */

const FORMAT = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const B64URL = /^[A-Za-z0-9_-]+$/;

export class SecretBoxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretBoxError";
  }
}

export interface MasterKey {
  version: number;
  key: Buffer;
}

export interface Sealed {
  ciphertext: string;
  keyVersion: number;
}

export interface SecretBox {
  readonly currentVersion: number;
  seal(plaintext: string, aad: string): Sealed;
  open(ciphertext: string, aad: string, keyVersion: number): string;
  /** La valeur a été chiffrée avec une autre clé que la courante (à rechiffrer). */
  isStale(keyVersion: number): boolean;
}

function checkKey(k: MasterKey): void {
  if (!Number.isInteger(k.version) || k.version < 1) throw new SecretBoxError("version de clé maître invalide");
  if (k.key.length !== KEY_BYTES) throw new SecretBoxError(`clé maître de ${KEY_BYTES} octets attendue`);
}

export function createSecretBox(keys: { current: MasterKey; previous?: MasterKey }): SecretBox {
  checkKey(keys.current);
  if (keys.previous) {
    checkKey(keys.previous);
    if (keys.previous.version === keys.current.version) throw new SecretBoxError("versions de clé maître identiques");
  }
  const byVersion = new Map<number, Buffer>([[keys.current.version, keys.current.key]]);
  if (keys.previous) byVersion.set(keys.previous.version, keys.previous.key);

  return {
    currentVersion: keys.current.version,

    seal(plaintext, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, keys.current.key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        ciphertext: [FORMAT, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":"),
        keyVersion: keys.current.version,
      };
    },

    open(ciphertext, aad, keyVersion) {
      const key = byVersion.get(keyVersion);
      if (!key) throw new SecretBoxError(`clé maître de version ${keyVersion} indisponible`);
      const parts = ciphertext.split(":");
      if (parts.length !== 4 || parts[0] !== FORMAT || !parts.slice(1).every((p) => B64URL.test(p))) {
        throw new SecretBoxError("format de valeur chiffrée invalide");
      }
      const iv = Buffer.from(parts[1]!, "base64url");
      const tag = Buffer.from(parts[2]!, "base64url");
      const ct = Buffer.from(parts[3]!, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretBoxError("format de valeur chiffrée invalide");
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(aad, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      } catch {
        // Pas de `cause` : le message d'OpenSSL n'apporte rien et on ne veut rien propager.
        throw new SecretBoxError("authentification de la valeur chiffrée échouée");
      }
    },

    isStale(keyVersion) {
      return keyVersion !== keys.current.version;
    },
  };
}

/** Clé maître absente ou invalide : erreur claire, sans jamais révéler de valeur. */
export class EncryptionKeyMissingError extends ConfigurationError {
  constructor(detail: string, production: boolean) {
    super(
      production
        ? "L'enregistrement des clés API n'est pas configuré sur ce serveur. Contactez l'administrateur."
        : `SETTINGS_ENCRYPTION_KEY manquante ou invalide (${detail}). Générez-la avec « openssl rand -base64 32 », ajoutez-la au fichier .env puis redémarrez le serveur.`,
      detail,
    );
  }
}

function decodeKey(value: string | undefined): Buffer | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const buf = Buffer.from(trimmed, "base64");
  return buf.length === KEY_BYTES ? buf : null;
}

type Env = Partial<Record<string, string | undefined>>;

/**
 * Construit la boîte à partir de l'environnement. Pas de cache : le décodage est
 * négligeable et une rotation prend effet au redémarrage comme à chaud.
 */
export function loadSecretBoxFromEnv(env: Env = process.env): SecretBox {
  const production = env.NODE_ENV === "production";
  if (!env.SETTINGS_ENCRYPTION_KEY?.trim()) {
    throw new EncryptionKeyMissingError("variable absente", production);
  }
  const current = decodeKey(env.SETTINGS_ENCRYPTION_KEY);
  if (!current) throw new EncryptionKeyMissingError("32 octets encodés en base64 attendus", production);

  const rawVersion = env.SETTINGS_ENCRYPTION_KEY_VERSION?.trim() || "1";
  const version = Number(rawVersion);
  if (!/^\d+$/.test(rawVersion) || !Number.isSafeInteger(version) || version < 1) {
    throw new EncryptionKeyMissingError("SETTINGS_ENCRYPTION_KEY_VERSION doit être un entier ≥ 1", production);
  }

  let previous: MasterKey | undefined;
  if (env.SETTINGS_ENCRYPTION_KEY_PREVIOUS?.trim()) {
    const key = decodeKey(env.SETTINGS_ENCRYPTION_KEY_PREVIOUS);
    if (!key) throw new EncryptionKeyMissingError("SETTINGS_ENCRYPTION_KEY_PREVIOUS invalide", production);
    if (version < 2) throw new EncryptionKeyMissingError("clé précédente fournie avec une version courante à 1", production);
    previous = { version: version - 1, key };
  }
  return createSecretBox({ current: { version, key: current }, previous });
}
