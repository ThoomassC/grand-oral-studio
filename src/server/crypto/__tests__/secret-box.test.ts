import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSecretBox,
  EncryptionKeyMissingError,
  loadSecretBoxFromEnv,
  SecretBoxError,
} from "@/server/crypto/secret-box";

const key1 = randomBytes(32);
const key2 = randomBytes(32);
const b64 = (b: Buffer) => b.toString("base64");

describe("secret-box (AES-256-GCM)", () => {
  const box = createSecretBox({ current: { version: 1, key: key1 } });

  it("devrait déchiffrer ce qu'il a chiffré (aller-retour)", () => {
    const sealed = box.seal("sk-ant-api03-secret", "user-1");
    expect(sealed.keyVersion).toBe(1);
    expect(box.open(sealed.ciphertext, "user-1", sealed.keyVersion)).toBe("sk-ant-api03-secret");
  });

  it("devrait produire le format versionné v1:iv:tag:ciphertext en base64url, sans le clair", () => {
    const { ciphertext } = box.seal("sk-ant-api03-secret", "user-1");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    for (const p of parts.slice(1)) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(parts[1]!, "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2]!, "base64url")).toHaveLength(16);
    expect(ciphertext).not.toContain("secret");
  });

  it("devrait utiliser un IV aléatoire (deux chiffrements du même clair diffèrent)", () => {
    expect(box.seal("x", "u").ciphertext).not.toBe(box.seal("x", "u").ciphertext);
  });

  it("devrait refuser de déchiffrer avec une AAD différente (valeur copiée vers un autre utilisateur)", () => {
    const { ciphertext } = box.seal("sk-ant-secret", "user-1");
    expect(() => box.open(ciphertext, "user-2", 1)).toThrow(SecretBoxError);
  });

  it.each([
    ["le chiffré", 3],
    ["le tag", 2],
    ["l'IV", 1],
  ])("devrait refuser une valeur dont %s a été altéré", (_label, index) => {
    const { ciphertext } = box.seal("sk-ant-secret", "user-1");
    const parts = ciphertext.split(":");
    const bytes = Buffer.from(parts[index]!, "base64url");
    bytes[0] = bytes[0]! ^ 0x01;
    parts[index] = bytes.toString("base64url");
    expect(() => box.open(parts.join(":"), "user-1", 1)).toThrow(SecretBoxError);
  });

  it.each(["", "v2:a:b:c", "v1:a:b", "nimporte quoi", "v1:!!:??:**"])("devrait refuser un format invalide (%s)", (bad) => {
    expect(() => box.open(bad, "user-1", 1)).toThrow(SecretBoxError);
  });

  it("ne devrait jamais inclure le clair ni l'AAD dans le message d'erreur", () => {
    const { ciphertext } = box.seal("sk-ant-tres-secret", "user-1");
    try {
      box.open(ciphertext, "user-2", 1);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/tres-secret|user-2/);
    }
  });

  it("devrait refuser une clé maître qui ne fait pas 32 octets", () => {
    expect(() => createSecretBox({ current: { version: 1, key: randomBytes(16) } })).toThrow(SecretBoxError);
  });
});

describe("secret-box — rotation", () => {
  it("devrait déchiffrer une valeur de l'ancienne clé et chiffrer avec la nouvelle", () => {
    const old = createSecretBox({ current: { version: 1, key: key1 } });
    const sealed = old.seal("sk-ant-old", "u");

    const rotated = createSecretBox({ current: { version: 2, key: key2 }, previous: { version: 1, key: key1 } });
    expect(rotated.open(sealed.ciphertext, "u", 1)).toBe("sk-ant-old");
    expect(rotated.currentVersion).toBe(2);
    expect(rotated.seal("x", "u").keyVersion).toBe(2);
    expect(rotated.isStale(1)).toBe(true);
    expect(rotated.isStale(2)).toBe(false);
  });

  it("devrait refuser une version de clé inconnue", () => {
    const box = createSecretBox({ current: { version: 2, key: key2 } });
    const sealed = createSecretBox({ current: { version: 1, key: key1 } }).seal("x", "u");
    expect(() => box.open(sealed.ciphertext, "u", 1)).toThrow(SecretBoxError);
  });

  it("ne devrait pas déchiffrer avec la mauvaise clé même si la version est annoncée", () => {
    const sealed = createSecretBox({ current: { version: 1, key: key1 } }).seal("x", "u");
    const wrong = createSecretBox({ current: { version: 1, key: key2 } });
    expect(() => wrong.open(sealed.ciphertext, "u", 1)).toThrow(SecretBoxError);
  });
});

describe("loadSecretBoxFromEnv", () => {
  it("devrait lever EncryptionKeyMissingError quand SETTINGS_ENCRYPTION_KEY est absente", () => {
    expect(() => loadSecretBoxFromEnv({ NODE_ENV: "development" })).toThrow(EncryptionKeyMissingError);
  });

  it("devrait indiquer la commande de génération en développement, pas en production", () => {
    const dev = (() => {
      try {
        loadSecretBoxFromEnv({ NODE_ENV: "development" });
      } catch (e) {
        return e as EncryptionKeyMissingError;
      }
    })();
    const prod = (() => {
      try {
        loadSecretBoxFromEnv({ NODE_ENV: "production" });
      } catch (e) {
        return e as EncryptionKeyMissingError;
      }
    })();
    expect(dev?.userMessage).toContain("openssl rand -base64 32");
    expect(prod?.userMessage).not.toContain("SETTINGS_ENCRYPTION_KEY");
  });

  it("devrait refuser une clé qui ne décode pas en 32 octets", () => {
    expect(() => loadSecretBoxFromEnv({ NODE_ENV: "development", SETTINGS_ENCRYPTION_KEY: b64(randomBytes(20)) })).toThrow(
      EncryptionKeyMissingError,
    );
  });

  it("devrait lire la version courante et la clé précédente (version - 1)", () => {
    const sealed = loadSecretBoxFromEnv({ NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: b64(key1) }).seal("x", "u");
    expect(sealed.keyVersion).toBe(1);
    const box = loadSecretBoxFromEnv({
      NODE_ENV: "test",
      SETTINGS_ENCRYPTION_KEY: b64(key2),
      SETTINGS_ENCRYPTION_KEY_VERSION: "2",
      SETTINGS_ENCRYPTION_KEY_PREVIOUS: b64(key1),
    });
    expect(box.open(sealed.ciphertext, "u", 1)).toBe("x");
    expect(box.currentVersion).toBe(2);
  });

  it("devrait refuser une version de clé invalide", () => {
    expect(() =>
      loadSecretBoxFromEnv({ NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: b64(key1), SETTINGS_ENCRYPTION_KEY_VERSION: "0" }),
    ).toThrow(EncryptionKeyMissingError);
  });
});
