import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSecretBoxFromEnv } from "@/server/crypto/secret-box";
import { db } from "@/server/db/client";
import { AiKeyUnreadableError } from "@/server/errors";
import {
  credentialAad,
  deleteCredential,
  findCredential,
  listCredentials,
  loadCredential,
  saveCredential,
  setCredentialModel,
} from "@/server/repo/ai-credentials";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger } from "./helpers";

setupTestDatabase();

const MASTER_1 = randomBytes(32).toString("base64");
const MASTER_2 = randomBytes(32).toString("base64");
const ENV = { NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: MASTER_1 } as const;
const ROTATED = {
  NODE_ENV: "test",
  SETTINGS_ENCRYPTION_KEY: MASTER_2,
  SETTINGS_ENCRYPTION_KEY_VERSION: "2",
  SETTINGS_ENCRYPTION_KEY_PREVIOUS: MASTER_1,
} as const;
const box = () => loadSecretBoxFromEnv(ENV);

const MISTRAL_KEY = `${"m".repeat(28)}MMMM`;
const OPENAI_KEY = `sk-proj-${"o".repeat(40)}OOOO`;
const CLAUDE_KEY = `sk-ant-api03-${"c".repeat(60)}CCCC`;

const load = (userId: string, provider: "claude" | "mistral" | "gemini" | "openai", env: Record<string, string | undefined> = ENV) =>
  loadCredential(userId, provider, { env, log: recordingLogger() });

async function save(userId: string, provider: "claude" | "mistral" | "gemini" | "openai", apiKey: string, model: string | null = null) {
  return saveCredential(userId, provider, { apiKey, model, verifiedAt: new Date() }, box());
}

/** Ligne recopiée par la migration v120_expand : chiffré 1.1 (AAD = userId), aadScheme 1. */
async function seedLegacyClaude(userId: string, apiKey = CLAUDE_KEY) {
  const sealed = box().seal(apiKey, userId);
  await db().userAiSettings.create({
    data: { userId, anthropicKeyCiphertext: sealed.ciphertext, anthropicKeyLast4: apiKey.slice(-4), keyVersion: sealed.keyVersion, engine: "claude" },
  });
  await db().userAiCredential.create({
    data: { userId, provider: "claude", ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, aadScheme: 1, last4: apiKey.slice(-4) },
  });
  return sealed;
}

describe("saveCredential / loadCredential", () => {
  it("devrait chiffrer chaque clé avec l'AAD userId:provider (aadScheme 2), jamais en clair", async () => {
    const a = await createUser("a");
    const meta = await save(a.id, "mistral", MISTRAL_KEY, "mistral-small-latest");
    expect(meta).toMatchObject({ provider: "mistral", last4: "MMMM", model: "mistral-small-latest", aadScheme: 2, keyVersion: 1 });

    const row = await db().userAiCredential.findUniqueOrThrow({ where: { userId_provider: { userId: a.id, provider: "mistral" } } });
    expect(row.ciphertext).toMatch(/^v1:/);
    expect(row.ciphertext).not.toContain("mmmm");
    expect(credentialAad(a.id, "mistral")).toBe(`${a.id}:mistral`);
    expect(box().open(row.ciphertext, `${a.id}:mistral`, row.keyVersion)).toBe(MISTRAL_KEY);
    expect(() => box().open(row.ciphertext, a.id, row.keyVersion)).toThrow();

    expect(await load(a.id, "mistral")).toEqual({ apiKey: MISTRAL_KEY, model: "mistral-small-latest" });
    expect(await load(a.id, "openai")).toBeNull();
  });

  it("devrait remplacer la clé d'un même fournisseur (une ligne, dernier gagnant) sans toucher aux autres", async () => {
    const a = await createUser("a");
    await save(a.id, "openai", OPENAI_KEY);
    await save(a.id, "mistral", MISTRAL_KEY);
    await Promise.all([save(a.id, "mistral", `${"x".repeat(28)}XXXX`), save(a.id, "mistral", `${"y".repeat(28)}YYYY`)]);
    expect(await db().userAiCredential.count({ where: { userId: a.id } })).toBe(2);
    const row = await findCredential(a.id, "mistral");
    expect(["XXXX", "YYYY"]).toContain(row!.last4);
    expect((await load(a.id, "mistral"))!.apiKey.slice(-4)).toBe(row!.last4);
    expect((await load(a.id, "openai"))!.apiKey).toBe(OPENAI_KEY);
  });

  it("ne devrait pas déchiffrer un chiffré recopié d'un fournisseur à l'autre (même utilisateur)", async () => {
    const a = await createUser("a");
    await save(a.id, "mistral", MISTRAL_KEY);
    const row = await db().userAiCredential.findUniqueOrThrow({ where: { userId_provider: { userId: a.id, provider: "mistral" } } });
    await db().userAiCredential.create({
      data: { userId: a.id, provider: "openai", ciphertext: row.ciphertext, keyVersion: row.keyVersion, aadScheme: 2, last4: "MMMM" },
    });
    await expect(load(a.id, "openai")).rejects.toBeInstanceOf(AiKeyUnreadableError);
  });

  it("ne devrait pas déchiffrer un chiffré recopié chez un autre utilisateur", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await save(a.id, "mistral", MISTRAL_KEY);
    const row = await db().userAiCredential.findUniqueOrThrow({ where: { userId_provider: { userId: a.id, provider: "mistral" } } });
    await db().userAiCredential.create({
      data: { userId: b.id, provider: "mistral", ciphertext: row.ciphertext, keyVersion: row.keyVersion, aadScheme: 2, last4: "MMMM" },
    });
    await expect(load(b.id, "mistral")).rejects.toBeInstanceOf(AiKeyUnreadableError);
  });

  it("devrait journaliser une clé illisible sans jamais exposer de secret", async () => {
    const a = await createUser("a");
    await save(a.id, "mistral", MISTRAL_KEY);
    const log = recordingLogger();
    await expect(loadCredential(a.id, "mistral", { env: { NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: MASTER_2 }, log })).rejects.toBeInstanceOf(
      AiKeyUnreadableError,
    );
    expect(log.events.map((e) => e.event)).toContain("ai_key.unreadable");
    expect(JSON.stringify(log.events)).not.toContain(MASTER_1);
    expect(JSON.stringify(log.events)).not.toContain(MISTRAL_KEY);
  });
});

describe("migration aadScheme 1 → 2 (clés recopiées de la 1.1)", () => {
  it("devrait lire une clé recopiée (AAD = userId) puis la rechiffrer en aadScheme 2", async () => {
    const a = await createUser("a");
    const legacy = await seedLegacyClaude(a.id);
    const log = recordingLogger();
    expect(await loadCredential(a.id, "claude", { env: ENV, log })).toEqual({ apiKey: CLAUDE_KEY, model: null });

    const row = await db().userAiCredential.findUniqueOrThrow({ where: { userId_provider: { userId: a.id, provider: "claude" } } });
    expect(row.aadScheme).toBe(2);
    expect(row.ciphertext).not.toBe(legacy.ciphertext);
    expect(box().open(row.ciphertext, `${a.id}:claude`, row.keyVersion)).toBe(CLAUDE_KEY);
    expect(log.events.find((e) => e.event === "ai_key.rewrapped")?.fields).toMatchObject({ provider: "claude", fromScheme: 1, toScheme: 2, applied: true });
    // Lecture suivante : rien à rechiffrer.
    expect(await load(a.id, "claude")).toEqual({ apiKey: CLAUDE_KEY, model: null });
  });

  it("devrait rechiffrer en une écriture une clé à l'ancien schéma ET à l'ancienne clé maître", async () => {
    const a = await createUser("a");
    await seedLegacyClaude(a.id);
    expect((await load(a.id, "claude", ROTATED))!.apiKey).toBe(CLAUDE_KEY);
    const row = await db().userAiCredential.findUniqueOrThrow({ where: { userId_provider: { userId: a.id, provider: "claude" } } });
    expect(row).toMatchObject({ aadScheme: 2, keyVersion: 2 });
    const onlyNew = { NODE_ENV: "test", SETTINGS_ENCRYPTION_KEY: MASTER_2, SETTINGS_ENCRYPTION_KEY_VERSION: "2" };
    expect((await load(a.id, "claude", onlyNew))!.apiKey).toBe(CLAUDE_KEY);
  });

  it("ne devrait pas écraser une clé remplacée entre la lecture et le rechiffrement (mise à jour conditionnelle)", async () => {
    const a = await createUser("a");
    await seedLegacyClaude(a.id);
    // Remplacement concurrent : la ligne a changé ; le rechiffrement de l'ancienne valeur ne doit rien écrire.
    const other = `sk-ant-api03-${"z".repeat(60)}ZZZZ`;
    const [first] = await Promise.all([load(a.id, "claude"), save(a.id, "claude", other)]);
    expect([CLAUDE_KEY, other]).toContain(first!.apiKey);
    expect((await load(a.id, "claude"))!.apiKey).toBe(other);
  });

  it("ne devrait plus lire les colonnes historiques de user_ai_settings", async () => {
    const a = await createUser("a");
    const sealed = box().seal(CLAUDE_KEY, a.id);
    await db().userAiSettings.create({
      data: { userId: a.id, anthropicKeyCiphertext: sealed.ciphertext, anthropicKeyLast4: "CCCC", keyVersion: sealed.keyVersion },
    });
    expect(await load(a.id, "claude")).toBeNull();
    expect(await listCredentials(a.id)).toEqual([]);
  });
});

describe("deleteCredential", () => {
  it("devrait vider AUSSI les colonnes historiques anthropicKey* en supprimant la connexion Claude", async () => {
    const a = await createUser("a");
    await seedLegacyClaude(a.id);
    expect(await deleteCredential(a.id, "claude")).toBe(true);
    expect(await db().userAiCredential.count()).toBe(0);
    const settings = await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } });
    expect(settings).toMatchObject({ anthropicKeyCiphertext: null, anthropicKeyLast4: null, keyVersion: null, engine: null, keySource: null });
  });

  it("devrait vider les colonnes historiques même sans ligne user_ai_credential (clé 1.1 non recopiée)", async () => {
    const a = await createUser("a");
    const sealed = box().seal(CLAUDE_KEY, a.id);
    await db().userAiSettings.create({
      data: { userId: a.id, anthropicKeyCiphertext: sealed.ciphertext, anthropicKeyLast4: "CCCC", keyVersion: sealed.keyVersion },
    });
    expect(await deleteCredential(a.id, "claude")).toBe(true);
    expect((await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).anthropicKeyCiphertext).toBeNull();
  });

  it("ne devrait pas toucher aux colonnes historiques en supprimant une autre connexion", async () => {
    const a = await createUser("a");
    const legacy = await seedLegacyClaude(a.id);
    await save(a.id, "mistral", MISTRAL_KEY);
    expect(await deleteCredential(a.id, "mistral")).toBe(true);
    const settings = await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } });
    expect(settings).toMatchObject({ anthropicKeyCiphertext: legacy.ciphertext, engine: "claude" });
    expect((await listCredentials(a.id)).map((c) => c.provider)).toEqual(["claude"]);
  });

  it("devrait ramener la sélection au choix par défaut si elle utilisait cette clé personnelle, et pas si elle utilise la clé d'équipe", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await save(a.id, "mistral", MISTRAL_KEY);
    await save(b.id, "mistral", MISTRAL_KEY);
    await db().userAiSettings.create({ data: { userId: a.id, engine: "mistral", keySource: "user" } });
    await db().userAiSettings.create({ data: { userId: b.id, engine: "mistral", keySource: "server" } });
    await deleteCredential(a.id, "mistral");
    await deleteCredential(b.id, "mistral");
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: a.id } })).toMatchObject({ engine: null, keySource: null });
    expect(await db().userAiSettings.findUniqueOrThrow({ where: { userId: b.id } })).toMatchObject({ engine: "mistral", keySource: "server" });
  });

  it("devrait être idempotent et ne supprimer que la connexion de l'appelant", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await save(a.id, "openai", OPENAI_KEY);
    await save(b.id, "openai", OPENAI_KEY);
    expect(await deleteCredential(a.id, "openai")).toBe(true);
    expect(await deleteCredential(a.id, "openai")).toBe(false);
    expect((await load(b.id, "openai"))!.apiKey).toBe(OPENAI_KEY);
  });

  it("devrait disparaître avec l'utilisateur (cascade)", async () => {
    const a = await createUser("a");
    await save(a.id, "gemini", `AIza${"g".repeat(35)}`);
    await db().user.delete({ where: { id: a.id } });
    expect(await db().userAiCredential.count()).toBe(0);
  });
});

describe("listCredentials / setCredentialModel", () => {
  it("devrait lister les métadonnées sans le chiffré, triées par fournisseur", async () => {
    const a = await createUser("a");
    await save(a.id, "openai", OPENAI_KEY);
    await save(a.id, "mistral", MISTRAL_KEY);
    const list = await listCredentials(a.id);
    expect(list.map((c) => c.provider)).toEqual(["mistral", "openai"]);
    expect(JSON.stringify(list)).not.toMatch(/v1:/);
    expect(list[0]).toMatchObject({ last4: "MMMM", model: null, aadScheme: 2 });
    expect(list[0]!.verifiedAt).toBeInstanceOf(Date);
  });

  it("devrait changer le modèle d'une connexion existante seulement", async () => {
    const a = await createUser("a");
    await save(a.id, "mistral", MISTRAL_KEY);
    expect(await setCredentialModel(a.id, "mistral", "mistral-small-latest")).toBe(true);
    expect(await setCredentialModel(a.id, "openai", "gpt-5")).toBe(false);
    expect((await findCredential(a.id, "mistral"))!.model).toBe("mistral-small-latest");
    expect((await load(a.id, "mistral"))!.apiKey).toBe(MISTRAL_KEY);
  });
});
