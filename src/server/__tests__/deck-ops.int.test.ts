import { describe, expect, it } from "vitest";
import { DeckSpecSchema, type DeckSpec, type Slide } from "@/domain/schemas";
import { db } from "@/server/db/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import * as decks from "@/server/repo/decks";
import { makeConformingDeck } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

/**
 * Édition structurelle d'un diaporama (v1.2) : insérer, supprimer, déplacer une
 * diapo, dupliquer le diaporama. Rôles (éditeur et plus), bornes 2..60,
 * couverture verrouillée, concurrence optimiste (même contrat qu'updateDeckSlide).
 */

async function setup() {
  const users = {
    owner: await createUser("owner"),
    editor: await createUser("editor"),
    viewer: await createUser("viewer"),
    stranger: await createUser("stranger"),
  };
  const programId = await seedProgram(users.owner.id);
  const [themeId] = await seedThemes(programId, [themeInput("Mobilités")]);
  await seedMember(programId, users.editor.id, "EDITOR");
  await seedMember(programId, users.viewer.id, "VIEWER");
  const deckId = await seedDeck(programId, themeId!, "FINAL");
  return { users, programId, themeId: themeId!, deckId };
}

async function stored(deckId: string): Promise<{ spec: DeckSpec; updatedAt: string }> {
  const row = await db().deck.findUniqueOrThrow({ where: { id: deckId }, select: { spec: true, updatedAt: true } });
  return { spec: DeckSpecSchema.parse(row.spec), updatedAt: row.updatedAt.toISOString() };
}

const titles = (spec: DeckSpec) => spec.slides.map((s) => s.title);

function deckOf(count: number): DeckSpec {
  const base = makeConformingDeck();
  const filler: Slide = { layout: "content", sectionId: "part2", title: "Diapo", subtitle: "", bullets: [], notes: "" };
  return { ...base, slides: [base.slides[0]!, ...Array.from({ length: count - 1 }, (_, i) => ({ ...filler, title: `Diapo ${i + 2}` }))] };
}

describe("insertSlide", () => {
  it("devrait insérer une diapo vierge de la même section à la position demandée", async () => {
    const { users, deckId, programId } = await setup();
    const before = await stored(deckId);
    const result = await decks.insertSlide(users.owner.id, deckId, 3, null, before.updatedAt);

    expect(result.programId).toBe(programId);
    expect(result.spec.slides).toHaveLength(10);
    expect(result.spec.slides[3]).toEqual({
      layout: "content",
      sectionId: "problem",
      title: "Nouvelle diapo",
      subtitle: "",
      bullets: [],
      notes: "",
    });
    expect(titles(result.spec).filter((_, i) => i !== 3)).toEqual(titles(before.spec));
    const after = await stored(deckId);
    expect(after.spec).toEqual(result.spec);
    expect(after.updatedAt).toBe(result.updatedAt);
    expect(result.updatedAt).not.toBe(before.updatedAt);
  });

  it("devrait reprendre la section de la diapo suivante après la couverture", async () => {
    const { users, deckId } = await setup();
    const result = await decks.insertSlide(users.editor.id, deckId, 1, null);
    expect(result.spec.slides[1]?.sectionId).toBe("intro");
  });

  it("devrait refuser une insertion avant la couverture, avec un message clair", async () => {
    const { users, deckId } = await setup();
    const error = await decks.insertSlide(users.owner.id, deckId, 0, null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toMatch(/couverture reste la première diapo/);
  });

  it("devrait refuser au-delà de 60 diapos", async () => {
    const { users, programId, themeId } = await setup();
    const full = await seedDeck(programId, themeId, "FINAL", deckOf(60));
    const error = await decks.insertSlide(users.owner.id, full, 5, null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toBe("Un diaporama compte au plus 60 diapos.");
    expect((await stored(full)).spec.slides).toHaveLength(60);
  });

  it("devrait refuser une version périmée sans rien écrire", async () => {
    const { users, deckId } = await setup();
    const before = await stored(deckId);
    await expect(decks.insertSlide(users.owner.id, deckId, 2, null, "2020-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await stored(deckId)).toEqual(before);
  });

  it("devrait refuser un lecteur (403) et un étranger (404)", async () => {
    const { users, deckId } = await setup();
    await expect(decks.insertSlide(users.viewer.id, deckId, 2, null)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decks.insertSlide(users.stranger.id, deckId, 2, null)).rejects.toBeInstanceOf(NotFoundError);
    expect((await stored(deckId)).spec.slides).toHaveLength(9);
  });

  it("devrait refuser une position hors du diaporama", async () => {
    const { users, deckId } = await setup();
    const error = await decks.insertSlide(users.owner.id, deckId, 42, null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toMatch(/n'existe plus/);
  });
});

describe("removeSlide", () => {
  it("devrait retirer la diapo visée", async () => {
    const { users, deckId } = await setup();
    const before = await stored(deckId);
    const result = await decks.removeSlide(users.editor.id, deckId, 4, before.updatedAt);
    expect(titles(result.spec)).toEqual(titles(before.spec).filter((_, i) => i !== 4));
    expect((await stored(deckId)).spec).toEqual(result.spec);
  });

  it("devrait refuser de supprimer la couverture", async () => {
    const { users, deckId } = await setup();
    const error = await decks.removeSlide(users.owner.id, deckId, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toMatch(/ne se supprime pas/);
  });

  it("devrait refuser de descendre sous 2 diapos", async () => {
    const { users, programId, themeId } = await setup();
    const small = await seedDeck(programId, themeId, "FINAL", deckOf(2));
    const error = await decks.removeSlide(users.owner.id, small, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toBe("Un diaporama compte au moins 2 diapos.");
  });

  it("devrait refuser un lecteur et une version périmée", async () => {
    const { users, deckId } = await setup();
    await expect(decks.removeSlide(users.viewer.id, deckId, 3)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decks.removeSlide(users.owner.id, deckId, 3, "2020-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await stored(deckId)).spec.slides).toHaveLength(9);
  });
});

describe("moveSlide", () => {
  it("devrait déplacer une diapo d'un cran vers le bas puis vers le haut", async () => {
    const { users, deckId } = await setup();
    const before = await stored(deckId);
    const down = await decks.moveSlide(users.owner.id, deckId, 3, 4, before.updatedAt);
    expect(down.spec.slides[4]?.title).toBe(before.spec.slides[3]?.title);
    expect(down.spec.slides[3]?.title).toBe(before.spec.slides[4]?.title);
    const up = await decks.moveSlide(users.owner.id, deckId, 4, 3, down.updatedAt);
    expect(up.spec).toEqual(before.spec);
  });

  it("devrait garder la couverture en tête", async () => {
    const { users, deckId } = await setup();
    const error = await decks.moveSlide(users.owner.id, deckId, 1, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toMatch(/ne se déplace pas/);
  });

  it("devrait refuser un lecteur, un étranger et une version périmée", async () => {
    const { users, deckId } = await setup();
    await expect(decks.moveSlide(users.viewer.id, deckId, 3, 4)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decks.moveSlide(users.stranger.id, deckId, 3, 4)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decks.moveSlide(users.owner.id, deckId, 3, 4, "2020-01-01T00:00:00.000Z")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("duplicateDeck", () => {
  it("devrait créer une copie indépendante du diaporama dans le même projet", async () => {
    const { users, deckId, programId, themeId } = await setup();
    await db().deck.update({ where: { id: deckId }, data: { practice: true, engine: "mock" } });

    const copy = await decks.duplicateDeck(users.editor.id, deckId);

    expect(copy.programId).toBe(programId);
    expect(copy.deckId).not.toBe(deckId);
    const row = await db().deck.findUniqueOrThrow({ where: { id: copy.deckId } });
    expect(row).toMatchObject({
      programId,
      themeId,
      kind: "FINAL",
      problem: "Une problématique",
      practice: true,
      engine: "mock",
      createdById: users.editor.id,
      prepStartedAt: null,
      deletedAt: null,
    });
    expect(DeckSpecSchema.parse(row.spec)).toEqual(makeConformingDeck());
    // Indépendance : modifier la copie ne touche pas l'original.
    await decks.removeSlide(users.editor.id, copy.deckId, 3);
    expect((await stored(deckId)).spec).toEqual(makeConformingDeck());
  });

  it("devrait refuser un lecteur (403) et un étranger (404)", async () => {
    const { users, deckId, programId } = await setup();
    await expect(decks.duplicateDeck(users.viewer.id, deckId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decks.duplicateDeck(users.stranger.id, deckId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deck.count({ where: { programId } })).toBe(1);
  });

  it("devrait refuser un diaporama à la corbeille", async () => {
    const { users, deckId } = await setup();
    await decks.deleteDeck(users.owner.id, deckId);
    await expect(decks.duplicateDeck(users.owner.id, deckId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait refuser un ancien squelette", async () => {
    const { users, programId, themeId } = await setup();
    await db().deck.deleteMany({ where: { programId } });
    const skeleton = await seedDeck(programId, themeId, "SKELETON");
    await expect(decks.duplicateDeck(users.owner.id, skeleton)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("getSlideEditContext (régénération d'une diapo)", () => {
  it("devrait renvoyer le deck, sa version, la trame et le sujet à un éditeur", async () => {
    const { users, deckId, programId, themeId } = await setup();
    const ctx = await decks.getSlideEditContext(users.editor.id, deckId);
    expect(ctx).toMatchObject({
      programId,
      spec: makeConformingDeck(),
      updatedAt: (await stored(deckId)).updatedAt,
      problem: "Une problématique",
      subject: { id: themeId, name: "Mobilités" },
    });
    expect(ctx.template.sections.length).toBeGreaterThan(0);
  });

  it("devrait refuser un lecteur (403) et un étranger (404)", async () => {
    const { users, deckId } = await setup();
    await expect(decks.getSlideEditContext(users.viewer.id, deckId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decks.getSlideEditContext(users.stranger.id, deckId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
