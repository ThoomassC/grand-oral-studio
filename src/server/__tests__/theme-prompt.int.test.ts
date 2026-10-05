import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeInput } from "@/domain/schemas";
import type { ResolvedEngine } from "@/server/ai";
import { createMockProvider } from "@/server/ai/mock";
import type { AiProvider } from "@/server/ai/types";
import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { AI_QUOTA, aiOwnKeyQuotaKey, aiQuotaKey, consumeQuota, importQuotaKey } from "@/server/rate-limit";
import { updateBrand } from "@/server/repo/programs";
import { analyzeThemePrompt } from "@/server/services/imports";
import { MAX_THEMES_PER_PROGRAM } from "@/server/validation";
import { makeBrand } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedProgram, seedThemes, themeInput } from "./helpers";

/**
 * Thèmes et charte depuis un prompt, contre la vraie base de test :
 *  - analyzeThemePrompt (service) : autorisation, quotas, rien d'écrit ;
 *  - importThemeList (Server Action, session simulée) : idempotence par nom,
 *    plafond de 60, autorisation, verrou sous appels concurrents.
 * Aucun réseau : moteurs gratuit et mock uniquement.
 */

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/server/session", () => ({
  requireUser: async () => ({ id: session.userId, email: `${session.userId}@example.test`, name: "U" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/ai", () => ({ getEngineForUser: async () => ({ engine: "free" }) }));

const { importThemeList } = await import("@/server/actions/imports");

setupTestDatabase();

const TEXT = "Thèmes : 1. Inflation 2. Chômage 3. Croissance. Couleur principale : #1F3A5F. Police des titres : Georgia.";

function deps(engine: ResolvedEngine) {
  return { log: recordingLogger(), resolveEngine: async () => engine };
}
const mockEngine = (provider: AiProvider = createMockProvider()): ResolvedEngine => ({ engine: "mock", provider, billing: "server" });

async function count(key: string): Promise<number> {
  return (await db().usageWindow.findUnique({ where: { key } }))?.count ?? 0;
}

async function snapshot(programId: string) {
  const program = await db().program.findUniqueOrThrow({
    where: { id: programId },
    select: { brand: true, template: true, brandSavedAt: true, templateSavedAt: true, updatedAt: true },
  });
  const themes = await db().theme.findMany({ where: { programId }, orderBy: { position: "asc" } });
  return { program, themes, decks: await db().deck.count() };
}

async function names(programId: string): Promise<{ name: string; position: number }[]> {
  return db().theme.findMany({ where: { programId }, orderBy: { position: "asc" }, select: { name: true, position: true } });
}

async function setup() {
  const [a, b] = [await createUser("a"), await createUser("b")];
  const programId = await seedProgram(a.id);
  return { a, b, programId };
}

const list = (...n: string[]): ThemeInput[] => n.map((name) => themeInput(name));

describe("analyzeThemePrompt — autorisation", () => {
  it("B ne peut pas analyser un prompt pour le projet de A (introuvable), sans consommer de quota", async () => {
    const { b, programId } = await setup();
    await expect(analyzeThemePrompt(b.id, programId, { text: TEXT }, deps({ engine: "free" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(analyzeThemePrompt(b.id, programId, { text: TEXT }, deps(mockEngine()))).rejects.toBeInstanceOf(NotFoundError);
    expect(await count(importQuotaKey(b.id))).toBe(0);
    expect(await count(aiQuotaKey(b.id))).toBe(0);
  });

  it("un projet inexistant est introuvable", async () => {
    const { a } = await setup();
    await expect(analyzeThemePrompt(a.id, "inexistant", { text: TEXT }, deps({ engine: "free" }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("analyzeThemePrompt — aucune écriture, charte actuelle comme base", () => {
  it("n'écrit ni thème ni charte (gratuit et IA), et complète depuis la charte enregistrée", async () => {
    const { a, programId } = await setup();
    const saved = { ...makeBrand(), name: "Charte du lycée", fonts: { heading: "Lato" as const, body: "Roboto" as const } };
    await updateBrand(a.id, programId, saved);
    await seedThemes(programId, list("Existant"));
    const before = await snapshot(programId);

    const free = await analyzeThemePrompt(a.id, programId, { text: TEXT }, deps({ engine: "free" }));
    const ai = await analyzeThemePrompt(a.id, programId, { text: TEXT }, deps(mockEngine()));

    expect([free.source, ai.source]).toEqual(["free", "ai"]);
    for (const out of [free, ai]) {
      expect(out.themes.map((t) => t.name)).toEqual(["Inflation", "Chômage", "Croissance"]);
      expect(out.brand?.name).toBe("Charte du lycée");
      expect(out.brand?.colors.primary).toBe("#1F3A5F");
      expect(out.brand?.fonts).toEqual({ heading: "Georgia", body: "Roboto" });
    }
    expect(await snapshot(programId)).toEqual(before);
  });
});

describe("analyzeThemePrompt — quotas", () => {
  it("gratuit : une unité d'import, aucun quota IA ; IA : une unité de chaque", async () => {
    const { a, programId } = await setup();
    await analyzeThemePrompt(a.id, programId, { text: TEXT }, deps({ engine: "free" }));
    expect(await count(importQuotaKey(a.id))).toBe(1);
    expect(await count(aiQuotaKey(a.id))).toBe(0);
    await analyzeThemePrompt(a.id, programId, { text: TEXT }, deps(mockEngine()));
    expect(await count(importQuotaKey(a.id))).toBe(2);
    expect(await count(aiQuotaKey(a.id))).toBe(1);
    expect(await count(aiOwnKeyQuotaKey(a.id))).toBe(0);
  });

  it("quota IA épuisé : repli gratuit avec la raison, sans appel IA", async () => {
    const { a, programId } = await setup();
    await consumeQuota(aiQuotaKey(a.id), AI_QUOTA.limit, AI_QUOTA);
    const draftThemes = vi.fn();
    const out = await analyzeThemePrompt(a.id, programId, { text: TEXT }, deps(mockEngine({ ...createMockProvider(), draftThemes })));
    expect(out.source).toBe("free");
    expect(out.fallbackReason).toMatch(/Trop de générations/);
    expect(out.themes).toHaveLength(3);
    expect(draftThemes).not.toHaveBeenCalled();
  });
});

describe("importThemeList (Server Action)", () => {
  let ids: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ids = await setup();
    session.userId = ids.a.id;
  });

  it("ajoute les thèmes à la suite des existants", async () => {
    await seedThemes(ids.programId, list("Existant"));
    const result = await importThemeList(ids.programId, { themes: list("Un", "Deux") });
    expect(result).toEqual({ ok: true, data: { created: 2, skipped: 0 } });
    expect(await names(ids.programId)).toEqual([
      { name: "Existant", position: 0 },
      { name: "Un", position: 1 },
      { name: "Deux", position: 2 },
    ]);
  });

  it("est idempotent par nom (casse et accents ignorés), doublons internes compris", async () => {
    await seedThemes(ids.programId, list("Énergie"));
    const first = await importThemeList(ids.programId, { themes: list("energie", "Climat", "CLIMAT") });
    expect(first).toEqual({ ok: true, data: { created: 1, skipped: 2 } });
    const replay = await importThemeList(ids.programId, { themes: list("energie", "Climat", "CLIMAT") });
    expect(replay).toEqual({ ok: true, data: { created: 0, skipped: 3 } });
    expect((await names(ids.programId)).map((t) => t.name)).toEqual(["Énergie", "Climat"]);
  });

  it("accepte la sortie d'analyzeThemePrompt telle quelle", async () => {
    const out = await analyzeThemePrompt(ids.a.id, ids.programId, { text: TEXT }, deps({ engine: "free" }));
    const result = await importThemeList(ids.programId, { themes: out.themes });
    expect(result).toEqual({ ok: true, data: { created: 3, skipped: 0 } });
  });

  it("refuse de dépasser 60 thèmes par projet, sans rien écrire", async () => {
    await seedThemes(
      ids.programId,
      Array.from({ length: MAX_THEMES_PER_PROGRAM - 1 }, (_, i) => themeInput(`Thème ${i}`)),
    );
    const before = await names(ids.programId);
    const result = await importThemeList(ids.programId, { themes: list("Nouveau un", "Nouveau deux") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/limité à 60 sujets/);
    expect(await names(ids.programId)).toEqual(before);
    // Les thèmes déjà présents ne comptent pas : un seul nouveau passe.
    expect(await importThemeList(ids.programId, { themes: list("Thème 0", "Nouveau un") })).toEqual({
      ok: true,
      data: { created: 1, skipped: 1 },
    });
  });

  it("valide l'entrée au bord (1 à 60 thèmes, bornes de ThemeInputSchema)", async () => {
    const tooMany = Array.from({ length: MAX_THEMES_PER_PROGRAM + 1 }, (_, i) => themeInput(`T${i}`));
    for (const input of [{ themes: [] }, { themes: tooMany }, { themes: [{ name: "x" }] }, {} as { themes: ThemeInput[] }]) {
      expect((await importThemeList(ids.programId, input)).ok).toBe(false);
    }
    expect(await db().theme.count()).toBe(0);
  });

  it("B ne peut pas ajouter de thèmes au projet de A (introuvable), rien n'est écrit", async () => {
    await seedThemes(ids.programId, list("Existant"));
    session.userId = ids.b.id;
    const result = await importThemeList(ids.programId, { themes: list("Intrus") });
    expect(result).toEqual({ ok: false, error: "Ce projet est introuvable." });
    expect(await names(ids.programId)).toEqual([{ name: "Existant", position: 0 }]);
  });

  it("deux ajouts simultanés de la même liste ne créent pas de doublon (verrou)", async () => {
    const themes = list("Un", "Deux", "Trois");
    const results = await Promise.all([
      importThemeList(ids.programId, { themes }),
      importThemeList(ids.programId, { themes }),
    ]);
    const created = results.map((r) => (r.ok ? r.data.created : -1)).sort();
    expect(created).toEqual([0, 3]);
    expect(await names(ids.programId)).toEqual([
      { name: "Un", position: 0 },
      { name: "Deux", position: 1 },
      { name: "Trois", position: 2 },
    ]);
  });
});
