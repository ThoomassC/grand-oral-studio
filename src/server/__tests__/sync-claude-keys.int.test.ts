import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { createUser, setupTestDatabase } from "@/test/db";

/**
 * scripts/sync-claude-keys.sql : à rejouer après le déploiement de la 1.2.0 (et avant le
 * « contract » de la 1.3). Il aligne user_ai_credential (provider 'claude', aadScheme 1)
 * sur les colonnes historiques anthropicKey* que le code 1.1 a pu modifier entre la
 * migration expand et la mise en ligne du code 1.2 : clé ajoutée, remplacée ou supprimée.
 * Les lignes déjà réécrites par le code 1.2 (aadScheme 2) ne sont jamais touchées.
 *
 * Le script est exécuté tel quel (psql) en production ; ici, ses instructions sont jouées
 * dans une transaction Prisma, BEGIN/COMMIT exceptés.
 */

setupTestDatabase();

const SCRIPT = path.join(process.cwd(), "scripts", "sync-claude-keys.sql");
const OLD = "v1:b2xk:dGFn:b2xk";
const NEW = "v1:bmV3:dGFn:bmV3";
const V2 = "v1:djI:dGFn:djI";

/** Instructions du script, sans commentaires ni BEGIN/COMMIT. */
function statements(): string[] {
  const sql = readFileSync(SCRIPT, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s !== "" && !/^(BEGIN|COMMIT)$/i.test(s));
}

async function runScript(): Promise<void> {
  const list = statements();
  await db().$transaction(async (tx) => {
    for (const sql of list) await tx.$executeRawUnsafe(sql);
  });
}

async function exec(sql: string, ...params: unknown[]): Promise<number> {
  return db().$executeRawUnsafe(sql, ...params);
}

function settings(userId: string, ciphertext: string | null, last4: string | null, keyVersion: number | null) {
  return exec(
    `INSERT INTO "user_ai_settings" ("userId", "anthropicKeyCiphertext", "anthropicKeyLast4", "keyVersion", "updatedAt")
     VALUES ($1, $2, $3, $4, now())`,
    userId,
    ciphertext,
    last4,
    keyVersion,
  );
}

function credential(userId: string, row: { ciphertext: string; last4: string; keyVersion: number; aadScheme: 1 | 2; provider?: string }) {
  return exec(
    `INSERT INTO "user_ai_credential" ("userId", "provider", "ciphertext", "keyVersion", "aadScheme", "last4", "model", "verifiedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'claude-sonnet', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
    userId,
    row.provider ?? "claude",
    row.ciphertext,
    row.keyVersion,
    row.aadScheme,
    row.last4,
  );
}

type Row = { userId: string; provider: string; ciphertext: string; keyVersion: number; aadScheme: number; last4: string; model: string | null; verified: boolean };

async function rows(): Promise<Row[]> {
  return db().$queryRawUnsafe<Row[]>(
    `SELECT "userId", "provider", "ciphertext", "keyVersion", "aadScheme", "last4", "model", "verifiedAt" IS NOT NULL AS verified
     FROM "user_ai_credential" ORDER BY "last4", "provider"`,
  );
}

describe("scripts/sync-claude-keys.sql", () => {
  it("devrait recopier, remplacer et retirer les clés Claude modifiées par le code 1.1, sans toucher aux clés réécrites par la 1.2", async () => {
    const added = await createUser("added"); // clé enregistrée par le 1.1 après la migration
    const replaced = await createUser("replaced"); // clé remplacée par le 1.1 après la migration
    const removed = await createUser("removed"); // clé supprimée par le 1.1 après la migration
    const noSettings = await createUser("no-settings"); // ligne recopiée, réglages disparus
    const unchanged = await createUser("unchanged"); // recopie toujours à jour
    const rewritten = await createUser("rewritten"); // clé réécrite par le code 1.2 (aadScheme 2)
    const rewrittenGone = await createUser("rewritten-gone"); // réécrite en 1.2, colonnes historiques vidées
    const otherProvider = await createUser("other-provider"); // clé Mistral : hors périmètre

    await settings(added.id, NEW, "add1", 2);
    await settings(replaced.id, NEW, "rep2", 3);
    await credential(replaced.id, { ciphertext: OLD, last4: "rep1", keyVersion: 1, aadScheme: 1 });
    await settings(removed.id, null, null, null);
    await credential(removed.id, { ciphertext: OLD, last4: "rem1", keyVersion: 1, aadScheme: 1 });
    await credential(noSettings.id, { ciphertext: OLD, last4: "nos1", keyVersion: 1, aadScheme: 1 });
    await settings(unchanged.id, OLD, "unc1", 1);
    await credential(unchanged.id, { ciphertext: OLD, last4: "unc1", keyVersion: 1, aadScheme: 1 });
    await settings(rewritten.id, OLD, "old1", 1);
    await credential(rewritten.id, { ciphertext: V2, last4: "rew2", keyVersion: 1, aadScheme: 2 });
    await settings(rewrittenGone.id, null, null, null);
    await credential(rewrittenGone.id, { ciphertext: V2, last4: "rwg2", keyVersion: 1, aadScheme: 2 });
    await settings(otherProvider.id, null, null, null);
    await credential(otherProvider.id, { ciphertext: OLD, last4: "mis1", keyVersion: 1, aadScheme: 1, provider: "mistral" });

    await runScript();
    const first = await rows();
    await runScript(); // rejouable : second passage sans effet
    expect(await rows()).toEqual(first);

    expect(first).toEqual([
      { userId: added.id, provider: "claude", ciphertext: NEW, keyVersion: 2, aadScheme: 1, last4: "add1", model: null, verified: false },
      { userId: otherProvider.id, provider: "mistral", ciphertext: OLD, keyVersion: 1, aadScheme: 1, last4: "mis1", model: "claude-sonnet", verified: true },
      // Remplacée : nouveau chiffré, modèle conservé, vérification remise à zéro (elle portait sur l'ancienne clé).
      { userId: replaced.id, provider: "claude", ciphertext: NEW, keyVersion: 3, aadScheme: 1, last4: "rep2", model: "claude-sonnet", verified: false },
      { userId: rewritten.id, provider: "claude", ciphertext: V2, keyVersion: 1, aadScheme: 2, last4: "rew2", model: "claude-sonnet", verified: true },
      { userId: rewrittenGone.id, provider: "claude", ciphertext: V2, keyVersion: 1, aadScheme: 2, last4: "rwg2", model: "claude-sonnet", verified: true },
      { userId: unchanged.id, provider: "claude", ciphertext: OLD, keyVersion: 1, aadScheme: 1, last4: "unc1", model: "claude-sonnet", verified: true },
    ]);
  });
});
