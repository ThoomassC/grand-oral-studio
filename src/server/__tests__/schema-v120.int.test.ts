import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedProgram, seedThemes, themeInput } from "./helpers";

/**
 * Schéma v1.2.0 (migrations 20261008090000_v120_expand et 20261008090100_v120_validate) :
 * les invariants sont tenus par la base (CHECK, clés étrangères, cascades), et le code
 * v1.1 continue d'écrire sans connaître les nouvelles colonnes (phase « expand »).
 *
 * Les insertions passent par du SQL brut paramétré : on teste la base, pas le client.
 */

setupTestDatabase();

const CIPHERTEXT = "v1:aXY:dGFn:Y2lwaGVy";

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

async function exec(sql: string, ...params: unknown[]): Promise<number> {
  return db().$executeRawUnsafe(sql, ...params);
}

async function expectViolation(promise: Promise<unknown>, constraint: string): Promise<void> {
  await expect(promise).rejects.toThrow(new RegExp(constraint));
}

async function count(table: string, where = "TRUE", ...params: unknown[]): Promise<number> {
  const rows = await db().$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`, ...params);
  return rows[0]!.n;
}

function insertCredential(userId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const row = { provider: "claude", ciphertext: CIPHERTEXT, keyVersion: 1, aadScheme: 2, last4: "abcd", model: null, ...overrides };
  return exec(
    `INSERT INTO "user_ai_credential" ("userId", "provider", "ciphertext", "keyVersion", "aadScheme", "last4", "model", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    userId,
    row.provider,
    row.ciphertext,
    row.keyVersion,
    row.aadScheme,
    row.last4,
    row.model,
  );
}

async function insertQuestion(deckId: string, position = 0, question = "Pourquoi ?", answer = "Parce que."): Promise<string> {
  const rows = await db().$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "DeckQuestion" ("id", "deckId", "position", "question", "answer")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4) RETURNING "id"`,
    deckId,
    position,
    question,
    answer,
  );
  return rows[0]!.id;
}

function insertReview(questionId: string, userId: string, status = "KNOWN") {
  return exec(
    `INSERT INTO "DeckQuestionReview" ("questionId", "userId", "status", "updatedAt") VALUES ($1, $2, $3, now())`,
    questionId,
    userId,
    status,
  );
}

function insertRehearsal(deckId: string, userId: string, totalSeconds = 600, perSlide = "[30, 45]") {
  return exec(
    `INSERT INTO "Rehearsal" ("id", "deckId", "userId", "totalSeconds", "perSlide")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb)`,
    deckId,
    userId,
    totalSeconds,
    perSlide,
  );
}

function insertMember(programId: string, userId: string, role = "EDITOR") {
  return exec(`INSERT INTO "ProgramMember" ("programId", "userId", "role") VALUES ($1, $2, $3)`, programId, userId, role);
}

function insertSharedModel(authorId: string, kind = "TEMPLATE", name = "Trame partagée", payload = "{}") {
  return exec(
    `INSERT INTO "SharedModel" ("id", "authorId", "kind", "name", "payload", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, now())`,
    authorId,
    kind,
    name,
    payload,
  );
}

async function setup() {
  const owner = await createUser("owner");
  const programId = await seedProgram(owner.id);
  const [themeId] = await seedThemes(programId, [themeInput("Un")]);
  const deckId = await seedDeck(programId, themeId!, "FINAL");
  return { owner, programId, themeId: themeId!, deckId };
}

describe("schéma v1.2.0 — user_ai_credential", () => {
  it("devrait accepter une clé chiffrée par fournisseur connu, une ligne par (userId, provider)", async () => {
    const a = await createUser("a");
    for (const provider of ["claude", "mistral", "gemini", "openai"]) {
      await insertCredential(a.id, { provider, model: provider === "claude" ? null : "un-modele" });
    }
    expect(await count("user_ai_credential", `"userId" = $1`, a.id)).toBe(4);
    await expectViolation(insertCredential(a.id, { provider: "claude" }), "user_ai_credential_pkey");
  });

  it("devrait refuser fournisseur, schéma d'AAD, format, version et 4 derniers caractères invalides", async () => {
    const a = await createUser("a");
    await expectViolation(insertCredential(a.id, { provider: "ollama" }), "user_ai_credential_provider_known");
    await expectViolation(insertCredential(a.id, { provider: "free" }), "user_ai_credential_provider_known");
    await expectViolation(insertCredential(a.id, { aadScheme: 3 }), "user_ai_credential_aad_scheme_known");
    await expectViolation(insertCredential(a.id, { aadScheme: 0 }), "user_ai_credential_aad_scheme_known");
    await expectViolation(insertCredential(a.id, { ciphertext: "sk-ant-en-clair" }), "user_ai_credential_ciphertext_format");
    await expectViolation(insertCredential(a.id, { keyVersion: 0 }), "user_ai_credential_key_version_positive");
    await expectViolation(insertCredential(a.id, { last4: "abc" }), "user_ai_credential_last4_length");
    await expectViolation(insertCredential(a.id, { model: "" }), "user_ai_credential_model_length");
  });

  it("devrait recopier la clé Anthropic historique (provider claude, aadScheme 1, même chiffré)", async () => {
    // Insérer une ligne « à l'ancienne » AVANT la migration est impossible en test (la base
    // de test est déjà migrée). On rejoue donc l'INSERT … SELECT exact de la migration,
    // extrait du fichier entre ses balises, sur une ligne historique insérée maintenant :
    // les colonnes anthropicKey* existent toujours (expand seulement).
    const sql = readFileSync(path.join(MIGRATIONS, "20261008090000_v120_expand", "migration.sql"), "utf8");
    const copy = /-- BEGIN copy_claude_keys\n([\s\S]*?)-- END copy_claude_keys/.exec(sql)?.[1];
    expect(copy, "bloc de recopie balisé dans la migration").toBeTruthy();

    const withKey = await createUser("with-key");
    const withoutKey = await createUser("without-key");
    const already = await createUser("already");
    await exec(
      `INSERT INTO "user_ai_settings" ("userId", "anthropicKeyCiphertext", "anthropicKeyLast4", "keyVersion", "engine", "updatedAt")
       VALUES ($1, $2, 'wxyz', 3, 'claude', now()), ($3, NULL, NULL, NULL, 'free', now()), ($4, $2, 'old1', 1, NULL, now())`,
      withKey.id,
      CIPHERTEXT,
      withoutKey.id,
      already.id,
    );
    await insertCredential(already.id, { last4: "new2", keyVersion: 2 });

    await exec(copy!);
    await exec(copy!); // rejouable : ON CONFLICT DO NOTHING

    const rows = await db().$queryRawUnsafe<
      { userId: string; provider: string; ciphertext: string; keyVersion: number; aadScheme: number; last4: string; model: string | null; verifiedAt: Date | null }[]
    >(`SELECT "userId", "provider", "ciphertext", "keyVersion", "aadScheme", "last4", "model", "verifiedAt" FROM "user_ai_credential" ORDER BY "last4"`);
    expect(rows).toEqual([
      { userId: already.id, provider: "claude", ciphertext: CIPHERTEXT, keyVersion: 2, aadScheme: 2, last4: "new2", model: null, verifiedAt: null },
      { userId: withKey.id, provider: "claude", ciphertext: CIPHERTEXT, keyVersion: 3, aadScheme: 1, last4: "wxyz", model: null, verifiedAt: null },
    ]);
    // Les colonnes historiques ne sont pas touchées (le code v1.1 les lit encore).
    expect(await count("user_ai_settings", `"anthropicKeyCiphertext" IS NOT NULL`)).toBe(2);
  });
});

describe("schéma v1.2.0 — user_ai_settings et Deck : moteurs et source de clé", () => {
  it("devrait accepter les nouveaux moteurs et keySource user | server | NULL", async () => {
    const a = await createUser("a");
    const b = await createUser("b");
    const c = await createUser("c");
    await exec(`INSERT INTO "user_ai_settings" ("userId", "engine", "keySource", "updatedAt") VALUES ($1, 'mistral', 'user', now())`, a.id);
    await exec(`INSERT INTO "user_ai_settings" ("userId", "engine", "keySource", "updatedAt") VALUES ($1, 'openai', 'server', now())`, b.id);
    await exec(`INSERT INTO "user_ai_settings" ("userId", "engine", "updatedAt") VALUES ($1, 'gemini', now())`, c.id);
    const rows = await db().$queryRawUnsafe<{ keySource: string | null }[]>(`SELECT "keySource" FROM "user_ai_settings" WHERE "userId" = $1`, c.id);
    expect(rows[0]!.keySource).toBeNull();

    const { programId, themeId } = await setup();
    for (const engine of ["mistral", "gemini", "openai", "claude", "mock"]) {
      const deckId = await seedDeck(programId, themeId, "FINAL");
      await exec(`UPDATE "Deck" SET "engine" = $1 WHERE "id" = $2`, engine, deckId);
    }
  });

  it("devrait refuser une source de clé ou un moteur inconnus", async () => {
    const a = await createUser("a");
    await expectViolation(
      exec(`INSERT INTO "user_ai_settings" ("userId", "keySource", "updatedAt") VALUES ($1, 'team', now())`, a.id),
      "user_ai_settings_key_source_known",
    );
    await expectViolation(
      exec(`INSERT INTO "user_ai_settings" ("userId", "engine", "updatedAt") VALUES ($1, 'mock', now())`, a.id),
      "user_ai_settings_engine_known",
    );
    const { deckId } = await setup();
    await expectViolation(exec(`UPDATE "Deck" SET "engine" = 'gpt' WHERE "id" = $1`, deckId), "Deck_engine_known");
  });
});

describe("schéma v1.2.0 — Theme.problems", () => {
  const problem = (i: number) => `Problématique numéro ${i} ?`;

  it("devrait accepter 30 problématiques de 10 à 1500 caractères", async () => {
    const { themeId } = await setup();
    const ok = [...Array.from({ length: 28 }, (_, i) => problem(i)), "x".repeat(10), "y".repeat(1500)];
    await exec(`UPDATE "Theme" SET "problems" = $1::text[] WHERE "id" = $2`, ok, themeId);
    expect(await count("Theme", `cardinality("problems") = 30`)).toBe(1);
  });

  it("devrait refuser 31 problématiques, un élément trop court, trop long ou NULL", async () => {
    const { themeId } = await setup();
    const set = (value: (string | null)[]) => exec(`UPDATE "Theme" SET "problems" = $1::text[] WHERE "id" = $2`, value, themeId);
    await expectViolation(set(Array.from({ length: 31 }, (_, i) => problem(i))), "Theme_problems_valid");
    await expectViolation(set(["trop court"].map((s) => s.slice(0, 9))), "Theme_problems_valid");
    await expectViolation(set(["z".repeat(1501)]), "Theme_problems_valid");
    await expectViolation(set([problem(1), null]), "Theme_problems_valid");
  });
});

describe("schéma v1.2.0 — Deck : entraînement et préparation", () => {
  it("devrait réserver practice et prepStartedAt aux decks FINAL", async () => {
    const { programId, themeId, deckId } = await setup();
    await exec(`UPDATE "Deck" SET "practice" = true, "prepStartedAt" = now() WHERE "id" = $1`, deckId);
    const skeletonId = await seedDeck(programId, themeId, "SKELETON");
    await expectViolation(exec(`UPDATE "Deck" SET "practice" = true WHERE "id" = $1`, skeletonId), "Deck_practice_final_only");
    await expectViolation(exec(`UPDATE "Deck" SET "prepStartedAt" = now() WHERE "id" = $1`, skeletonId), "Deck_prep_started_final_only");
  });
});

describe("schéma v1.2.0 — partage, questions, répétitions, modèles", () => {
  it("devrait refuser rôle, statut, durée, perSlide, genre et nom invalides", async () => {
    const { owner, programId, deckId } = await setup();
    const b = await createUser("b");
    await expectViolation(insertMember(programId, b.id, "OWNER"), "ProgramMember_role_known");
    await insertMember(programId, b.id, "VIEWER");
    await expectViolation(insertMember(programId, b.id, "EDITOR"), "ProgramMember_pkey");

    const questionId = await insertQuestion(deckId);
    await expectViolation(insertQuestion(deckId, 0, "Doublon ?"), "DeckQuestion_deckId_position_key");
    await expectViolation(insertQuestion(deckId, 1, ""), "DeckQuestion_question_length");
    await expectViolation(insertQuestion(deckId, 2, "q".repeat(1001)), "DeckQuestion_question_length");
    await expectViolation(insertQuestion(deckId, 3, "Question ?", "a".repeat(4001)), "DeckQuestion_answer_length");
    await expectViolation(insertReview(questionId, owner.id, "DONE"), "DeckQuestionReview_status_known");
    await insertReview(questionId, owner.id, "TO_REVIEW");
    await insertReview(questionId, b.id, "KNOWN");

    await expectViolation(insertRehearsal(deckId, owner.id, 0), "Rehearsal_total_seconds_range");
    await expectViolation(insertRehearsal(deckId, owner.id, 7201), "Rehearsal_total_seconds_range");
    await expectViolation(insertRehearsal(deckId, owner.id, 60, `{"1": 30}`), "Rehearsal_per_slide_is_array");
    await insertRehearsal(deckId, owner.id, 7200, "[]");

    await expectViolation(insertSharedModel(owner.id, "THEME"), "SharedModel_kind_known");
    await expectViolation(insertSharedModel(owner.id, "BRAND", ""), "SharedModel_name_length");
    await expectViolation(insertSharedModel(owner.id, "BRAND", "n".repeat(121)), "SharedModel_name_length");
    await expectViolation(insertSharedModel(owner.id, "BRAND", "Charte", "[]"), "SharedModel_payload_is_object");
    await insertSharedModel(owner.id, "BRAND", "Charte", `{"primary": "#000"}`);
  });

  it("devrait tout effacer à la suppression d'un utilisateur, sauf ses decks dans le projet d'autrui (créateur mis à NULL)", async () => {
    const { programId, deckId } = await setup();
    const b = await createUser("b");
    await insertMember(programId, b.id, "EDITOR");
    const bDeckId = await seedDeck(programId, null, "FINAL");
    await exec(`UPDATE "Deck" SET "createdById" = $1 WHERE "id" IN ($2, $3)`, b.id, deckId, bDeckId);
    const questionId = await insertQuestion(deckId);
    await insertReview(questionId, b.id);
    await insertRehearsal(deckId, b.id);
    await insertSharedModel(b.id);
    await insertCredential(b.id);

    await db().user.delete({ where: { id: b.id } });

    expect(await count("ProgramMember")).toBe(0);
    expect(await count("DeckQuestionReview")).toBe(0);
    expect(await count("Rehearsal")).toBe(0);
    expect(await count("SharedModel")).toBe(0);
    expect(await count("user_ai_credential")).toBe(0);
    expect(await count("DeckQuestion")).toBe(1);
    expect(await count("Deck", `"createdById" IS NULL AND "id" IN ($1, $2)`, deckId, bDeckId)).toBe(2);
  });

  it("devrait effacer questions, statuts et répétitions avec le deck, et les membres avec le projet", async () => {
    const { owner, programId, deckId } = await setup();
    const b = await createUser("b");
    await insertMember(programId, b.id, "VIEWER");
    const questionId = await insertQuestion(deckId);
    await insertReview(questionId, b.id);
    await insertRehearsal(deckId, b.id);

    await db().deck.delete({ where: { id: deckId } });
    expect(await count("DeckQuestion")).toBe(0);
    expect(await count("DeckQuestionReview")).toBe(0);
    expect(await count("Rehearsal")).toBe(0);
    expect(await count("ProgramMember")).toBe(1);

    await db().program.delete({ where: { id: programId } });
    expect(await count("ProgramMember")).toBe(0);
    expect(await count("user", `"id" IN ($1, $2)`, owner.id, b.id)).toBe(2);
  });
});

describe("schéma v1.2.0 — compatibilité du code v1.1 (expand)", () => {
  it("devrait insérer un Theme sans updatedAt ni problems, et un Deck FINAL sans practice", async () => {
    const owner = await createUser("owner");
    const programId = await seedProgram(owner.id);
    // Exactement les colonnes qu'écrit le code v1.1 (SQL brut : le client régénéré poserait updatedAt).
    await exec(
      `INSERT INTO "Theme" ("id", "programId", "position", "name") VALUES ('theme-v11', $1, 0, 'Sujet v1.1')`,
      programId,
    );
    await exec(
      `INSERT INTO "Deck" ("id", "programId", "themeId", "kind", "problem", "spec", "updatedAt")
       VALUES ('deck-v11', $1, 'theme-v11', 'FINAL', 'Une problématique', '{}'::jsonb, now())`,
      programId,
    );
    const theme = await db().$queryRawUnsafe<{ problems: string[]; updatedAt: Date }[]>(
      `SELECT "problems", "updatedAt" FROM "Theme" WHERE "id" = 'theme-v11'`,
    );
    expect(theme[0]!.problems).toEqual([]);
    expect(theme[0]!.updatedAt).toBeInstanceOf(Date);
    const deck = await db().$queryRawUnsafe<{ practice: boolean; prepStartedAt: Date | null; createdById: string | null; deletedAt: Date | null }[]>(
      `SELECT "practice", "prepStartedAt", "createdById", "deletedAt" FROM "Deck" WHERE "id" = 'deck-v11'`,
    );
    expect(deck[0]).toEqual({ practice: false, prepStartedAt: null, createdById: null, deletedAt: null });
    const program = await db().$queryRawUnsafe<{ deletedAt: Date | null; exportTriedAt: Date | null }[]>(
      `SELECT "deletedAt", "exportTriedAt" FROM "Program" WHERE "id" = $1`,
      programId,
    );
    expect(program[0]).toEqual({ deletedAt: null, exportTriedAt: null });
  });

  it("devrait avoir validé toutes les contraintes posées NOT VALID (migration v120_validate)", async () => {
    const rows = await db().$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace = 'public'::regnamespace`,
    );
    expect(rows).toEqual([]);
  });
});
