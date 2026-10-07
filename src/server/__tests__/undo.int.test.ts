import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import * as decks from "@/server/repo/decks";
import * as programs from "@/server/repo/programs";
import { getProfile } from "@/server/repo/profile";
import { createUser, setupTestDatabase } from "@/test/db";
import { purgeTrash } from "@/server/repo/trash";
import { seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

/**
 * Corbeille (v1.2) : suppression douce des projets et des diaporamas, restauration
 * possible 30 s côté serveur, purge opportuniste au-delà d'une heure. Les anciens
 * squelettes ne passent jamais par la corbeille.
 */

const ago = (ms: number) => new Date(Date.now() - ms);
const SECOND = 1000;
const HOUR = 3600 * SECOND;

async function setup() {
  const [owner, editor] = [await createUser("owner"), await createUser("editor")];
  const programId = await seedProgram(owner.id, "Projet");
  const [themeId] = await seedThemes(programId, [themeInput("Énergie")]);
  const deckId = await seedDeck(programId, themeId!, "FINAL");
  await seedMember(programId, editor.id, "EDITOR");
  return { owner, editor, programId, themeId: themeId!, deckId };
}

const deletedAtOf = {
  program: async (id: string) => (await db().program.findUnique({ where: { id }, select: { deletedAt: true } }))?.deletedAt,
  deck: async (id: string) => (await db().deck.findUnique({ where: { id }, select: { deletedAt: true } }))?.deletedAt,
};

describe("projet — suppression douce et restauration", () => {
  it("deleteProgram marque le projet supprimé, garde ses données et renvoie undoUntil ≈ maintenant + 30 s", async () => {
    const s = await setup();
    const before = Date.now();
    const { undoUntil } = await programs.deleteProgram(s.owner.id, s.programId);
    const until = new Date(undoUntil).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 29 * SECOND);
    expect(until).toBeLessThanOrEqual(Date.now() + 31 * SECOND);
    expect(await deletedAtOf.program(s.programId)).toBeInstanceOf(Date);
    expect(await db().theme.count({ where: { programId: s.programId } })).toBe(1);
    expect(await db().deck.count({ where: { programId: s.programId } })).toBe(1);
  });

  it("un projet supprimé disparaît des listes, du détail, du profil et de ses decks", async () => {
    const s = await setup();
    await programs.deleteProgram(s.owner.id, s.programId);
    expect(await programs.listPrograms(s.owner.id)).toEqual([]);
    expect(await programs.listPrograms(s.editor.id)).toEqual([]);
    await expect(programs.getProgram(s.owner.id, s.programId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decks.getDeck(s.owner.id, s.deckId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decks.listFinalDecks(s.owner.id, s.programId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getProfile(s.owner.id))?.projectCount).toBe(0);
  });

  it("une seconde suppression du même projet lève NotFoundError", async () => {
    const s = await setup();
    await programs.deleteProgram(s.owner.id, s.programId);
    await expect(programs.deleteProgram(s.owner.id, s.programId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("restoreProgram dans le délai rend le projet tel qu'il était", async () => {
    const s = await setup();
    const before = await programs.getProgram(s.owner.id, s.programId);
    await programs.deleteProgram(s.owner.id, s.programId);
    await programs.restoreProgram(s.owner.id, s.programId);
    expect(await deletedAtOf.program(s.programId)).toBeNull();
    const after = await programs.getProgram(s.owner.id, s.programId);
    expect({ ...after, updatedAt: null }).toEqual({ ...before, updatedAt: null });
    expect((await programs.listPrograms(s.editor.id)).map((p) => p.id)).toEqual([s.programId]);
  });

  it("restoreProgram hors délai (> 30 s) lève NotFoundError et laisse le projet à la corbeille", async () => {
    const s = await setup();
    await programs.deleteProgram(s.owner.id, s.programId);
    await db().program.update({ where: { id: s.programId }, data: { deletedAt: ago(31 * SECOND) } });
    await expect(programs.restoreProgram(s.owner.id, s.programId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await deletedAtOf.program(s.programId)).toBeInstanceOf(Date);
  });

  it("restoreProgram d'un projet actif ou inconnu lève NotFoundError", async () => {
    const s = await setup();
    await expect(programs.restoreProgram(s.owner.id, s.programId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(programs.restoreProgram(s.owner.id, "inexistant")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("seul le propriétaire supprime ou restaure : un éditeur reçoit ForbiddenError", async () => {
    const s = await setup();
    await expect(programs.deleteProgram(s.editor.id, s.programId)).rejects.toBeInstanceOf(ForbiddenError);
    await programs.deleteProgram(s.owner.id, s.programId);
    await expect(programs.restoreProgram(s.editor.id, s.programId)).rejects.toBeInstanceOf(ForbiddenError);
    const stranger = await createUser("stranger");
    await expect(programs.restoreProgram(stranger.id, s.programId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await deletedAtOf.program(s.programId)).toBeInstanceOf(Date);
  });
});

describe("diaporama — suppression douce et restauration", () => {
  it("deleteDeck (FINAL) le met à la corbeille et renvoie programId, themeId et undoUntil", async () => {
    const s = await setup();
    const result = await decks.deleteDeck(s.editor.id, s.deckId);
    expect(result).toMatchObject({ programId: s.programId, themeId: s.themeId });
    expect(new Date(result.undoUntil!).getTime()).toBeGreaterThan(Date.now() + 25 * SECOND);
    expect(await deletedAtOf.deck(s.deckId)).toBeInstanceOf(Date);
  });

  it("un deck supprimé disparaît de la liste, des compteurs et de l'avancement", async () => {
    const s = await setup();
    const before = await programs.getProgram(s.owner.id, s.programId);
    expect(before.finalDeckCount).toBe(1);
    expect(before.themes[0]!.finalDeckCount).toBe(1);
    const beforeList = (await programs.listPrograms(s.owner.id))[0]!;

    await decks.deleteDeck(s.owner.id, s.deckId);

    const after = await programs.getProgram(s.owner.id, s.programId);
    expect(after.finalDeckCount).toBe(0);
    expect(after.themes[0]!.finalDeckCount).toBe(0);
    expect(after.progress).toEqual(
      (await programs.getProgram(s.owner.id, await seedEmptyTwin(s.owner.id, s.programId))).progress,
    );
    expect(await decks.listFinalDecks(s.owner.id, s.programId)).toEqual([]);
    await expect(decks.getDeck(s.owner.id, s.deckId)).rejects.toBeInstanceOf(NotFoundError);
    const afterList = (await programs.listPrograms(s.owner.id)).find((p) => p.id === s.programId)!;
    expect(afterList.progress.doneCount).toBeLessThanOrEqual(beforeList.progress.doneCount);
    expect(afterList.progress).toEqual(
      (await programs.listPrograms(s.owner.id)).find((p) => p.name === "Jumeau")!.progress,
    );
  });

  it("restoreDeck dans le délai le rend visible ; une seconde restauration lève NotFoundError", async () => {
    const s = await setup();
    await decks.deleteDeck(s.owner.id, s.deckId);
    expect(await decks.restoreDeck(s.editor.id, s.deckId)).toEqual({ programId: s.programId, themeId: s.themeId });
    expect((await decks.getDeck(s.owner.id, s.deckId)).id).toBe(s.deckId);
    expect((await programs.getProgram(s.owner.id, s.programId)).finalDeckCount).toBe(1);
    await expect(decks.restoreDeck(s.editor.id, s.deckId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("restoreDeck hors délai lève NotFoundError", async () => {
    const s = await setup();
    await decks.deleteDeck(s.owner.id, s.deckId);
    await db().deck.update({ where: { id: s.deckId }, data: { deletedAt: ago(31 * SECOND) } });
    await expect(decks.restoreDeck(s.owner.id, s.deckId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("restoreDeck refuse un deck dont le projet est à la corbeille", async () => {
    const s = await setup();
    await decks.deleteDeck(s.owner.id, s.deckId);
    await programs.deleteProgram(s.owner.id, s.programId);
    await expect(decks.restoreDeck(s.owner.id, s.deckId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("un ancien squelette est supprimé définitivement, sans délai d'annulation", async () => {
    const s = await setup();
    const skeletonId = await seedDeck(s.programId, s.themeId, "SKELETON");
    const result = await decks.deleteDeck(s.owner.id, skeletonId);
    expect(result).toEqual({ programId: s.programId, themeId: s.themeId });
    expect(result.undoUntil).toBeUndefined();
    expect(await db().deck.count({ where: { id: skeletonId } })).toBe(0);
    await expect(decks.restoreDeck(s.owner.id, skeletonId)).rejects.toBeInstanceOf(NotFoundError);
    // L'unicité « un squelette par sujet » reste libre pour un nouveau squelette.
    await expect(seedDeck(s.programId, s.themeId, "SKELETON")).resolves.toEqual(expect.any(String));
  });

  it("deux suppressions simultanées du même deck : une seule réussit", async () => {
    const s = await setup();
    const results = await Promise.allSettled([decks.deleteDeck(s.owner.id, s.deckId), decks.deleteDeck(s.editor.id, s.deckId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(NotFoundError);
  });
});

describe("corbeille — purge et lectures", () => {
  it("la purge, déclenchée par une suppression, efface définitivement ce qui est à la corbeille depuis plus d'une heure", async () => {
    const s = await setup();
    const oldProgram = await seedProgram(s.owner.id, "Ancien");
    const [oldTheme] = await seedThemes(oldProgram, [themeInput("Vieux")]);
    await seedDeck(oldProgram, oldTheme!, "FINAL");
    await db().program.update({ where: { id: oldProgram }, data: { deletedAt: ago(2 * HOUR) } });
    const oldDeck = await seedDeck(s.programId, s.themeId, "FINAL");
    await db().deck.update({ where: { id: oldDeck }, data: { deletedAt: ago(2 * HOUR) } });
    const recentDeck = await seedDeck(s.programId, s.themeId, "FINAL");
    await db().deck.update({ where: { id: recentDeck }, data: { deletedAt: ago(10 * 60 * SECOND) } });

    await decks.deleteDeck(s.owner.id, s.deckId);

    expect(await db().program.count({ where: { id: oldProgram } })).toBe(0);
    expect(await db().theme.count({ where: { programId: oldProgram } })).toBe(0);
    expect(await db().deck.count({ where: { programId: oldProgram } })).toBe(0);
    expect(await db().deck.count({ where: { id: oldDeck } })).toBe(0);
    // Moins d'une heure : conservé (hors délai de restauration, mais pas encore purgé).
    expect(await db().deck.count({ where: { id: recentDeck } })).toBe(1);
    expect(await db().deck.count({ where: { id: s.deckId } })).toBe(1);
  });

  it("deleteProgram déclenche aussi la purge", async () => {
    const s = await setup();
    const oldDeck = await seedDeck(s.programId, s.themeId, "FINAL");
    await db().deck.update({ where: { id: oldDeck }, data: { deletedAt: ago(2 * HOUR) } });
    const other = await seedProgram(s.owner.id, "Autre");
    await programs.deleteProgram(s.owner.id, other);
    expect(await db().deck.count({ where: { id: oldDeck } })).toBe(0);
  });

  it("restaurer un élément purgé lève NotFoundError", async () => {
    const s = await setup();
    await decks.deleteDeck(s.owner.id, s.deckId);
    await db().deck.update({ where: { id: s.deckId }, data: { deletedAt: ago(2 * HOUR) } });
    await purgeTrash();
    await expect(decks.restoreDeck(s.owner.id, s.deckId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la duplication ignore les decks à la corbeille", async () => {
    const s = await setup();
    const skeleton = await seedDeck(s.programId, s.themeId, "SKELETON");
    await db().deck.update({ where: { id: skeleton }, data: { deletedAt: new Date() } });
    const { id } = await programs.duplicateProgram(s.owner.id, s.programId);
    expect(await db().deck.count({ where: { programId: id } })).toBe(0);
    expect((await programs.getProgram(s.owner.id, id)).themes[0]!.skeleton).toBeNull();
  });

  it("getProgram ne montre pas un squelette à la corbeille", async () => {
    const s = await setup();
    const skeleton = await seedDeck(s.programId, s.themeId, "SKELETON");
    expect((await programs.getProgram(s.owner.id, s.programId)).themes[0]!.skeleton?.id).toBe(skeleton);
    await db().deck.update({ where: { id: skeleton }, data: { deletedAt: new Date() } });
    expect((await programs.getProgram(s.owner.id, s.programId)).themes[0]!.skeleton).toBeNull();
  });
});

/** Projet identique (mêmes sujets, aucun deck) : référence d'avancement « sans deck final ». */
async function seedEmptyTwin(ownerId: string, programId: string): Promise<string> {
  const source = await programs.getProgram(ownerId, programId);
  const twin = await seedProgram(ownerId, "Jumeau");
  await seedThemes(
    twin,
    source.themes.map((t) => themeInput(t.name)),
  );
  return twin;
}
