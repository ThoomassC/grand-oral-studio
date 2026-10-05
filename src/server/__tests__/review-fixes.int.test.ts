import { describe, expect, it } from "vitest";
import type { Slide } from "@/domain/schemas";
import { db } from "@/server/db/client";
import { ConflictError, RateLimitedError } from "@/server/errors";
import { AI_GLOBAL_QUOTA_KEY, consumeAiQuota } from "@/server/rate-limit";
import * as decks from "@/server/repo/decks";
import * as programs from "@/server/repo/programs";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

const CONFLICT_MESSAGE =
  "Ce diaporama a changé entre-temps (autre onglet). Rechargez la page pour voir la dernière version.";

const edited: Slide = { layout: "content", sectionId: "part1", title: "Modifiée", subtitle: "", bullets: ["Puce"], notes: "" };

async function setup() {
  const a = await createUser("a");
  const programId = await seedProgram(a.id);
  const themeIds = await seedThemes(programId, [themeInput("Un"), themeInput("Deux"), themeInput("Trois")]);
  return { a, programId, themeIds: themeIds as [string, string, string] };
}

describe("updateDeckSlide — concurrence optimiste", () => {
  it("devrait exposer updatedAt en ISO dans getDeck", async () => {
    const { a, programId, themeIds } = await setup();
    const deckId = await seedDeck(programId, themeIds[0], "FINAL");
    const deck = await decks.getDeck(a.id, deckId);
    expect(typeof deck.updatedAt).toBe("string");
    expect(new Date(deck.updatedAt).toISOString()).toBe(deck.updatedAt);
  });

  it("devrait refuser la seconde de deux éditions basées sur la même version", async () => {
    const { a, programId, themeIds } = await setup();
    const deckId = await seedDeck(programId, themeIds[0], "FINAL");
    const { updatedAt } = await decks.getDeck(a.id, deckId);

    const first = await decks.updateDeckSlide(a.id, deckId, 1, { ...edited, title: "Premier" }, updatedAt);
    expect(first.updatedAt).not.toBe(updatedAt);

    const second = decks.updateDeckSlide(a.id, deckId, 2, { ...edited, title: "Second" }, updatedAt);
    await expect(second).rejects.toBeInstanceOf(ConflictError);
    await expect(second).rejects.toMatchObject({ userMessage: CONFLICT_MESSAGE });

    const { spec } = await decks.getDeck(a.id, deckId);
    expect(spec.slides[1]!.title).toBe("Premier");
    expect(spec.slides[2]!.title).not.toBe("Second");
  });

  it("devrait accepter une édition basée sur la version renvoyée par la précédente", async () => {
    const { a, programId, themeIds } = await setup();
    const deckId = await seedDeck(programId, themeIds[0], "FINAL");
    const { updatedAt } = await decks.getDeck(a.id, deckId);
    const first = await decks.updateDeckSlide(a.id, deckId, 1, edited, updatedAt);
    await expect(decks.updateDeckSlide(a.id, deckId, 2, edited, first.updatedAt)).resolves.toBeDefined();
  });
});

describe("compteurs de lecture", () => {
  it("devrait exposer themeCount (sujets) dans listPrograms, sans compteur de squelettes", async () => {
    const { a, programId, themeIds } = await setup();
    await seedDeck(programId, themeIds[0], "SKELETON");
    await seedDeck(programId, themeIds[1], "FINAL");
    const [summary] = await programs.listPrograms(a.id);
    expect(summary).toMatchObject({ id: programId, themeCount: 3 });
    expect(summary).not.toHaveProperty("skeletonCount");
  });

  it("devrait exposer finalDeckCount par thème dans getProgram", async () => {
    const { a, programId, themeIds } = await setup();
    await seedDeck(programId, themeIds[0], "SKELETON");
    await seedDeck(programId, themeIds[0], "FINAL");
    await seedDeck(programId, themeIds[0], "FINAL");
    const detail = await programs.getProgram(a.id, programId);
    expect(detail.themes.map((t) => t.finalDeckCount)).toEqual([2, 0, 0]);
  });
});

describe("quota IA global", () => {
  it("devrait refuser au-delà du plafond global même si le quota utilisateur n'est pas atteint", async () => {
    const [u1, u2] = [await createUser("u1"), await createUser("u2")];
    const policies = { user: { limit: 10, windowSeconds: 3600 }, global: { limit: 3, windowSeconds: 3600 } };
    await consumeAiQuota(u1.id, 2, policies);
    await consumeAiQuota(u2.id, 1, policies);
    const error = await consumeAiQuota(u2.id, 1, policies).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).userMessage).toMatch(/très sollicité/);
    // Le refus global ne consomme rien côté utilisateur.
    const row = await db().usageWindow.findUnique({ where: { key: `ai:${u2.id}` } });
    expect(row?.count).toBe(1);
    expect((await db().usageWindow.findUnique({ where: { key: AI_GLOBAL_QUOTA_KEY } }))?.count).toBe(3);
  });
});
