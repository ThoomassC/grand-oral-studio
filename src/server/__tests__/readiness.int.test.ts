import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import * as readiness from "@/server/repo/readiness";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedMember, seedProgram } from "./helpers";

setupTestDatabase();

async function practiceDeck(programId: string): Promise<string> {
  const id = await seedDeck(programId, null, "FINAL");
  await db().deck.update({ where: { id }, data: { practice: true }, select: { id: true } });
  return id;
}

async function rehearse(deckId: string, userId: string): Promise<void> {
  await db().rehearsal.create({ data: { deckId, userId, totalSeconds: 60, perSlide: [] }, select: { id: true } });
}

describe("liste « Avant l'examen » : compteurs", () => {
  it("devrait compter tous les diaporamas actifs (entraînement et jour J) et les répétitions de l'utilisateur, lecteur compris", async () => {
    const [owner, viewer, stranger] = [await createUser("o"), await createUser("v"), await createUser("s")];
    const programId = await seedProgram(owner.id);
    await seedMember(programId, viewer.id, "VIEWER");
    const p1 = await practiceDeck(programId);
    const p2 = await practiceDeck(programId);
    const exam = await seedDeck(programId, null, "FINAL");
    await db().deck.update({ where: { id: p2 }, data: { deletedAt: new Date() }, select: { id: true } });
    await rehearse(p1, owner.id);
    await rehearse(exam, owner.id);
    await rehearse(p2, owner.id); // diaporama à la corbeille : ne compte pas
    await rehearse(p1, viewer.id);

    expect(await readiness.getExamReadiness(owner.id, programId)).toEqual({ decks: 2, rehearsals: 2, exportTried: false });
    expect(await readiness.getExamReadiness(viewer.id, programId)).toEqual({ decks: 2, rehearsals: 1, exportTried: false });
    expect(await readiness.getExamReadiness(stranger.id, programId)).toEqual({ decks: 0, rehearsals: 0, exportTried: false });
  });

  it("markExportTried devrait noter l'export sans toucher Program.updatedAt, une seule fois", async () => {
    const owner = await createUser("o");
    const programId = await seedProgram(owner.id);
    const before = await db().program.findUniqueOrThrow({ where: { id: programId }, select: { updatedAt: true } });
    await readiness.markExportTried(programId);
    const first = await db().program.findUniqueOrThrow({ where: { id: programId }, select: { updatedAt: true, exportTriedAt: true } });
    expect(first.updatedAt).toEqual(before.updatedAt);
    expect(first.exportTriedAt).toBeInstanceOf(Date);
    await readiness.markExportTried(programId);
    const second = await db().program.findUniqueOrThrow({ where: { id: programId }, select: { exportTriedAt: true } });
    expect(second.exportTriedAt).toEqual(first.exportTriedAt);
    expect(await readiness.exportTried(owner.id, programId)).toBe(true);
  });
});
