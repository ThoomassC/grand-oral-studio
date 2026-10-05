import { describe, expect, it } from "vitest";
import { RETIRED_FORMAT_MESSAGE } from "@/domain/import/file-kind";
import { buildPptx, FAKE_PDF } from "@/domain/import/__tests__/fixtures";
import { db } from "@/server/db/client";
import { NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import { aiOwnKeyQuotaKey, aiQuotaKey, consumeQuota, IMPORT_QUOTA, importQuotaKey } from "@/server/rate-limit";
import { updateTemplate } from "@/server/repo/programs";
import { analyzeBrandFile, analyzeTemplatePrompt, type ImportFile } from "@/server/services/imports";
import { makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedProgram } from "./helpers";

/** Imports contre la vraie base de test : autorisation, aucune écriture, seul le quota d'import consommé (aucune IA). */

setupTestDatabase();

const TEXT = "Durée : 12 min\n1. Introduction\n2. Développement (3 diapos)\n3. Conclusion";

function file(name: string, bytes: Uint8Array): ImportFile {
  return { name, size: bytes.byteLength, bytes: async () => bytes };
}

function deps() {
  return { log: recordingLogger() };
}

async function count(key: string): Promise<number> {
  return (await db().usageWindow.findUnique({ where: { key } }))?.count ?? 0;
}

/** Instantané de tout ce qu'un import pourrait toucher. */
async function snapshot(programId: string) {
  const program = await db().program.findUniqueOrThrow({
    where: { id: programId },
    select: { brand: true, template: true, brandSavedAt: true, templateSavedAt: true, updatedAt: true },
  });
  const [decks, themes] = await Promise.all([db().deck.count(), db().theme.count()]);
  return { program, decks, themes };
}

async function setup() {
  const [a, b] = [await createUser("a"), await createUser("b")];
  const programId = await seedProgram(a.id);
  return { a, b, programId };
}

describe("imports — autorisation", () => {
  it("B ne peut pas analyser un fichier pour le projet de A (introuvable), sans consommer de quota", async () => {
    const { b, programId } = await setup();
    await expect(analyzeBrandFile(b.id, programId, file("apparence.pptx", await buildPptx()), deps())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await count(importQuotaKey(b.id))).toBe(0);
  });

  it("B ne peut pas analyser des consignes pour le projet de A", async () => {
    const { b, programId } = await setup();
    await expect(analyzeTemplatePrompt(b.id, programId, { text: TEXT }, deps())).rejects.toBeInstanceOf(NotFoundError);
    expect(await count(importQuotaKey(b.id))).toBe(0);
  });

  it("un projet inexistant est introuvable", async () => {
    const { a } = await setup();
    await expect(analyzeTemplatePrompt(a.id, "inexistant", { text: TEXT }, deps())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("imports — aucune écriture", () => {
  it("n'enregistre ni l'apparence ni la trame", async () => {
    const { a, programId } = await setup();
    const before = await snapshot(programId);

    const office = await analyzeBrandFile(a.id, programId, file("c.pptx", await buildPptx({ name: "Autre" })), deps());
    const template = await analyzeTemplatePrompt(a.id, programId, { text: TEXT }, deps());

    expect(office.brand.name).toBe("Autre");
    expect(template.template.durationMinutes).toBe(12);
    expect(await snapshot(programId)).toEqual(before);
  });
});

describe("imports — quotas", () => {
  it("Office : une unité d'import, aucun quota IA", async () => {
    const { a, programId } = await setup();
    await analyzeBrandFile(a.id, programId, file("c.pptx", await buildPptx()), deps());
    expect(await count(importQuotaKey(a.id))).toBe(1);
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(0);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
  });

  it("trame depuis un prompt : une unité d'import, aucun quota IA", async () => {
    const { a, programId } = await setup();
    await analyzeTemplatePrompt(a.id, programId, { text: TEXT }, deps());
    expect(await count(importQuotaKey(a.id))).toBe(1);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(0);
  });

  it("PDF : refusé avec le message dédié, sans quota IA ni écriture", async () => {
    const { a, programId } = await setup();
    const before = await snapshot(programId);
    const error = await analyzeBrandFile(a.id, programId, file("c.pdf", FAKE_PDF), deps()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toBe(RETIRED_FORMAT_MESSAGE);
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(0);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
    expect(await snapshot(programId)).toEqual(before);
  });

  it("limite de débit des imports atteinte : refus explicite", async () => {
    const { a, programId } = await setup();
    await consumeQuota(importQuotaKey(a.id), IMPORT_QUOTA.limit, IMPORT_QUOTA, "import");
    const error = await analyzeTemplatePrompt(a.id, programId, { text: TEXT }, deps()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).scope).toBe("import");
  });
});

describe("imports — base de la trame", () => {
  it("part de la trame enregistrée du projet", async () => {
    const { a, programId } = await setup();
    await updateTemplate(a.id, programId, makeTemplate({ tone: "Ton enregistré", language: "en" }));
    const out = await analyzeTemplatePrompt(a.id, programId, { text: "Durée : 9 min" }, deps());
    expect(out.template).toMatchObject({ tone: "Ton enregistré", language: "en", durationMinutes: 9 });
  });

  it("lit la colonne Durée d'un tableau : durées des lignes et durée de l'oral", async () => {
    const { a, programId } = await setup();
    const text = [
      "| Diapo | Titre | Contenu type | Durée |",
      "|---|---|---|---|",
      "| 1 | Titre | Problématique | 0:30 |",
      "| 2-3 | Contexte | Enjeu | 4:00 |",
      "| 4 | Conclusion | Réponse | 2:30 |",
    ].join("\n");
    const out = await analyzeTemplatePrompt(a.id, programId, { text }, deps());
    expect(out.template.sections.map((s) => s.seconds)).toEqual([240, 150]);
    expect(out.template.durationMinutes).toBe(7);
    // La proposition s'enregistre telle quelle (refine des durées compris).
    await updateTemplate(a.id, programId, out.template);
    const stored = await db().program.findUniqueOrThrow({ where: { id: programId }, select: { template: true } });
    expect(stored.template).toMatchObject({ durationMinutes: 7, sections: [{ seconds: 240 }, { seconds: 150 }] });
  });
});
