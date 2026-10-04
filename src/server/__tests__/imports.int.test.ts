import { describe, expect, it } from "vitest";
import { buildPptx, FAKE_PDF } from "@/domain/import/__tests__/fixtures";
import type { ResolvedEngine } from "@/server/ai";
import { createMockProvider } from "@/server/ai/mock";
import type { AiProvider } from "@/server/ai/types";
import { db } from "@/server/db/client";
import { NotFoundError, RateLimitedError } from "@/server/errors";
import {
  AI_QUOTA,
  aiOwnKeyQuotaKey,
  aiQuotaKey,
  consumeQuota,
  IMPORT_QUOTA,
  importQuotaKey,
} from "@/server/rate-limit";
import { updateTemplate } from "@/server/repo/programs";
import { analyzeBrandFile, analyzeTemplatePrompt, type ImportFile } from "@/server/services/imports";
import { makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedProgram } from "./helpers";

setupTestDatabase();

const TEXT = "Durée : 12 min\n1. Introduction\n2. Développement (3 diapos)\n3. Conclusion";

function file(name: string, bytes: Uint8Array): ImportFile {
  return { name, size: bytes.byteLength, bytes: async () => bytes };
}

function deps(engine: ResolvedEngine) {
  return { log: recordingLogger(), resolveEngine: async () => engine };
}

const claudeMock = (provider: AiProvider = createMockProvider()): ResolvedEngine => ({ engine: "claude", provider, billing: "user" });

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
    await expect(
      analyzeBrandFile(b.id, programId, file("charte.pptx", await buildPptx()), deps({ engine: "free" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      analyzeBrandFile(b.id, programId, file("charte.pdf", FAKE_PDF), deps(claudeMock())),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await count(importQuotaKey(b.id))).toBe(0);
    expect(await count(aiOwnKeyQuotaKey(b.id))).toBe(0);
  });

  it("B ne peut pas analyser des consignes pour le projet de A", async () => {
    const { b, programId } = await setup();
    await expect(analyzeTemplatePrompt(b.id, programId, { text: TEXT }, deps({ engine: "free" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await count(importQuotaKey(b.id))).toBe(0);
  });

  it("un projet inexistant est introuvable", async () => {
    const { a } = await setup();
    await expect(analyzeTemplatePrompt(a.id, "inexistant", { text: TEXT }, deps({ engine: "free" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("imports — aucune écriture", () => {
  it("n'enregistre ni la charte ni le gabarit (Office, vision, gratuit, IA)", async () => {
    const { a, programId } = await setup();
    const before = await snapshot(programId);

    const office = await analyzeBrandFile(a.id, programId, file("c.pptx", await buildPptx({ name: "Autre" })), deps({ engine: "free" }));
    const vision = await analyzeBrandFile(a.id, programId, file("c.pdf", FAKE_PDF), deps(claudeMock()));
    const free = await analyzeTemplatePrompt(a.id, programId, { text: TEXT }, deps({ engine: "free" }));
    const ai = await analyzeTemplatePrompt(a.id, programId, { text: TEXT }, deps(claudeMock()));

    expect([office.source, vision.source, free.source, ai.source]).toEqual(["office", "ai", "free", "ai"]);
    expect(office.brand.name).toBe("Autre");
    expect(await snapshot(programId)).toEqual(before);
  });
});

describe("imports — quotas", () => {
  it("Office : une unité d'import, aucun quota IA", async () => {
    const { a, programId } = await setup();
    await analyzeBrandFile(a.id, programId, file("c.pptx", await buildPptx()), deps({ engine: "free" }));
    expect(await count(importQuotaKey(a.id))).toBe(1);
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(0);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
  });

  it("vision : une unité d'import et une unité de quota IA (clé de l'utilisateur)", async () => {
    const { a, programId } = await setup();
    await analyzeBrandFile(a.id, programId, file("c.pdf", FAKE_PDF), deps(claudeMock()));
    expect(await count(importQuotaKey(a.id))).toBe(1);
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(1);
  });

  it("vision refusée hors Claude : aucun quota IA consommé", async () => {
    const { a, programId } = await setup();
    await expect(analyzeBrandFile(a.id, programId, file("c.pdf", FAKE_PDF), deps({ engine: "free" }))).rejects.toThrow(
      /moteur Claude/,
    );
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(0);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
  });

  it("limite de débit des imports atteinte : refus explicite", async () => {
    const { a, programId } = await setup();
    await consumeQuota(importQuotaKey(a.id), IMPORT_QUOTA.limit, IMPORT_QUOTA, "import");
    const error = await analyzeTemplatePrompt(a.id, programId, { text: TEXT }, deps({ engine: "free" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).scope).toBe("import");
  });

  it("gabarit : quota IA (serveur) épuisé → repli gratuit avec la raison, sans appel IA", async () => {
    const { a, programId } = await setup();
    await consumeQuota(aiQuotaKey(a.id), AI_QUOTA.limit, AI_QUOTA);
    let called = 0;
    const provider: AiProvider = {
      ...createMockProvider(),
      draftTemplate: async () => {
        called += 1;
        return {};
      },
    };
    const out = await analyzeTemplatePrompt(a.id, programId, { text: TEXT }, deps({ engine: "mock", provider, billing: "server" }));
    expect(out.source).toBe("free");
    expect(out.fallbackReason).toMatch(/Trop de générations/);
    expect(out.template.durationMinutes).toBe(12);
    expect(called).toBe(0);
  });
});

describe("imports — base du gabarit", () => {
  it("part du gabarit enregistré du projet", async () => {
    const { a, programId } = await setup();
    await updateTemplate(a.id, programId, makeTemplate({ tone: "Ton enregistré", language: "en" }));
    const out = await analyzeTemplatePrompt(a.id, programId, { text: "Durée : 9 min" }, deps({ engine: "free" }));
    expect(out.template).toMatchObject({ tone: "Ton enregistré", language: "en", durationMinutes: 9 });
  });
});
