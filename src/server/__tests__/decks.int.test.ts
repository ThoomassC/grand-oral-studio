import { describe, expect, it } from "vitest";
import type { DeckSpec, Slide } from "@/domain/schemas";
import { db } from "@/server/db/client";
import { DataIntegrityError, NotFoundError, ValidationError } from "@/server/errors";
import * as decks from "@/server/repo/decks";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

const editedSlide: Slide = {
  layout: "content",
  sectionId: "part1",
  title: "Diapo modifiée",
  subtitle: "",
  bullets: ["Nouvelle puce"],
  notes: "Nouvelle note",
};

/** Un programme de A avec deux thèmes. */
async function ownedSetup() {
  const [a, b] = [await createUser("a"), await createUser("b")];
  const programId = await seedProgram(a.id);
  const [themeId, otherThemeId] = await seedThemes(programId, [themeInput("Un"), themeInput("Deux")]);
  return { a, b, programId, themeId: themeId!, otherThemeId: otherThemeId! };
}

describe("repo decks — autorisation", () => {
  it("devrait lever NotFoundError quand B lit, modifie ou supprime un deck de A", async () => {
    const { a, b, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");

    await expect(decks.getDeck(b.id, deckId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decks.updateDeckSlide(b.id, deckId, 1, editedSlide)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decks.deleteDeck(b.id, deckId)).rejects.toBeInstanceOf(NotFoundError);

    expect((await decks.getDeck(a.id, deckId)).spec).toEqual(makeConformingDeck());
  });

  it("devrait lever NotFoundError quand B liste les decks finaux du programme de A", async () => {
    const { b, programId, themeId } = await ownedSetup();
    await seedDeck(programId, themeId, "FINAL");
    await expect(decks.listFinalDecks(b.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait lever NotFoundError et ne rien créer quand B écrit un squelette sur un thème de A", async () => {
    const { b, themeId } = await ownedSetup();
    await expect(decks.upsertSkeleton(b.id, themeId, makeConformingDeck())).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deck.count({ where: { themeId } })).toBe(0);
  });

  it("ne devrait pas écraser le squelette de A quand B tente un upsert", async () => {
    const { a, b, themeId } = await ownedSetup();
    await decks.upsertSkeleton(a.id, themeId, makeConformingDeck());
    const hostile: DeckSpec = { ...makeConformingDeck(), title: "Piraté" };
    await expect(decks.upsertSkeleton(b.id, themeId, hostile)).rejects.toBeInstanceOf(NotFoundError);
    const row = await db().deck.findFirstOrThrow({ where: { themeId, kind: "SKELETON" } });
    expect(row.spec).toMatchObject({ title: makeConformingDeck().title });
  });

  it("devrait lever NotFoundError quand B crée un deck final dans le programme de A", async () => {
    const { b, programId, themeId } = await ownedSetup();
    await expect(
      decks.createFinalDeck(b.id, { programId, themeId, problem: "Une problématique", spec: makeConformingDeck() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait lever NotFoundError quand B crée un deck final dans son programme avec le thème de A", async () => {
    const { b, themeId } = await ownedSetup();
    const programB = await seedProgram(b.id);
    await expect(
      decks.createFinalDeck(b.id, { programId: programB, themeId, problem: "Une problématique", spec: makeConformingDeck() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deck.count({ where: { themeId } })).toBe(0);
  });

  it("devrait lever NotFoundError quand le thème appartient à un autre programme du même utilisateur", async () => {
    const { a, themeId } = await ownedSetup();
    const otherProgram = await seedProgram(a.id, "Autre");
    await expect(
      decks.createFinalDeck(a.id, { programId: otherProgram, themeId, problem: "Une problématique", spec: makeConformingDeck() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait lever NotFoundError quand B demande le contexte de génération de A", async () => {
    const { b, programId, themeId } = await ownedSetup();
    await expect(decks.getGenerationContext(b.id, programId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decks.getThemeGenerationContext(b.id, themeId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ne devrait pas retrouver le deck récent de A pour B", async () => {
    const { a, b, programId, themeId } = await ownedSetup();
    await decks.createFinalDeck(a.id, { programId, themeId, problem: "Même problématique", spec: makeConformingDeck() });
    expect(
      await decks.findRecentFinalDeck(b.id, { programId, themeId, problem: "Même problématique", sinceMs: 60_000 }),
    ).toBeNull();
  });
});

describe("repo decks — unicité du squelette par thème", () => {
  it("devrait remplacer le squelette existant au lieu d'en créer un second", async () => {
    const { a, themeId } = await ownedSetup();
    const first = await decks.upsertSkeleton(a.id, themeId, makeConformingDeck());
    const second = await decks.upsertSkeleton(a.id, themeId, { ...makeConformingDeck(), title: "Version 2" });

    expect(second.deckId).toBe(first.deckId);
    expect(await db().deck.count({ where: { themeId, kind: "SKELETON" } })).toBe(1);
    expect((await decks.getDeck(a.id, first.deckId)).spec.title).toBe("Version 2");
  });

  it("devrait garder un seul squelette quand plusieurs upserts arrivent en même temps", async () => {
    const { a, themeId } = await ownedSetup();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => decks.upsertSkeleton(a.id, themeId, { ...makeConformingDeck(), title: `V${i}` })),
    );
    expect(new Set(results.map((r) => r.deckId)).size).toBe(1);
    expect(await db().deck.count({ where: { themeId, kind: "SKELETON" } })).toBe(1);
  });

  it("devrait être garanti par la base quand on insère un second squelette directement", async () => {
    const { programId, themeId } = await ownedSetup();
    await seedDeck(programId, themeId, "SKELETON");
    await expect(seedDeck(programId, themeId, "SKELETON")).rejects.toThrow();
    expect(await db().deck.count({ where: { themeId, kind: "SKELETON" } })).toBe(1);
  });

  it("devrait accepter plusieurs decks finaux et un squelette sur le même thème", async () => {
    const { a, programId, themeId } = await ownedSetup();
    await decks.upsertSkeleton(a.id, themeId, makeConformingDeck());
    await decks.createFinalDeck(a.id, { programId, themeId, problem: "Première", spec: makeConformingDeck() });
    await decks.createFinalDeck(a.id, { programId, themeId, problem: "Seconde", spec: makeConformingDeck() });
    expect(await db().deck.count({ where: { themeId } })).toBe(3);
  });

  it("devrait exposer le squelette dans le contexte de génération du thème", async () => {
    const { a, themeId, otherThemeId } = await ownedSetup();
    await decks.upsertSkeleton(a.id, themeId, makeConformingDeck());
    expect((await decks.getThemeGenerationContext(a.id, themeId)).skeleton).toEqual(makeConformingDeck());
    expect((await decks.getThemeGenerationContext(a.id, otherThemeId)).skeleton).toBeNull();
  });
});

describe("repo decks — modification d'une diapo", () => {
  it("devrait remplacer la diapo ciblée et garder les autres", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");
    await decks.updateDeckSlide(a.id, deckId, 3, editedSlide);
    const { spec } = await decks.getDeck(a.id, deckId);
    expect(spec.slides[3]).toEqual(editedSlide);
    expect(spec.slides.filter((_, i) => i !== 3)).toEqual(makeConformingDeck().slides.filter((_, i) => i !== 3));
  });

  it("ne devrait perdre aucune modification quand deux diapos sont modifiées en même temps", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");
    await Promise.all([
      decks.updateDeckSlide(a.id, deckId, 1, { ...editedSlide, title: "Un" }),
      decks.updateDeckSlide(a.id, deckId, 2, { ...editedSlide, title: "Deux" }),
      decks.updateDeckSlide(a.id, deckId, 4, { ...editedSlide, title: "Quatre" }),
    ]);
    const { spec } = await decks.getDeck(a.id, deckId);
    expect([spec.slides[1]!.title, spec.slides[2]!.title, spec.slides[4]!.title]).toEqual(["Un", "Deux", "Quatre"]);
  });

  it.each([-1, 9, 59])("devrait lever ValidationError quand l'index %i est hors du deck", async (index) => {
    const { a, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");
    await expect(decks.updateDeckSlide(a.id, deckId, index, editedSlide)).rejects.toBeInstanceOf(ValidationError);
  });

  it("devrait refuser d'écrire une diapo hors schéma et garder le deck intact", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");
    const invalid: Slide = { ...editedSlide, title: "x".repeat(500) };
    await expect(decks.updateDeckSlide(a.id, deckId, 1, invalid)).rejects.toBeInstanceOf(DataIntegrityError);
    expect((await decks.getDeck(a.id, deckId)).spec).toEqual(makeConformingDeck());
  });
});

describe("repo decks — validation zod à l'écriture", () => {
  it("devrait refuser un squelette hors schéma et ne rien écrire", async () => {
    const { a, themeId } = await ownedSetup();
    const oneSlide: DeckSpec = { ...makeConformingDeck(), slides: makeConformingDeck().slides.slice(0, 1) };
    await expect(decks.upsertSkeleton(a.id, themeId, oneSlide)).rejects.toBeInstanceOf(DataIntegrityError);
    expect(await db().deck.count({ where: { themeId } })).toBe(0);
  });

  it("devrait refuser un deck final hors schéma et ne rien écrire", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const badLayout = { ...makeConformingDeck(), slides: [{ ...editedSlide, layout: "inconnu" }, editedSlide] } as unknown as DeckSpec;
    await expect(
      decks.createFinalDeck(a.id, { programId, themeId, problem: "Une problématique", spec: badLayout }),
    ).rejects.toBeInstanceOf(DataIntegrityError);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait lever DataIntegrityError à la lecture d'un spec corrompu en base", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");
    await db().deck.update({ where: { id: deckId }, data: { spec: { title: "" } } });
    await expect(decks.getDeck(a.id, deckId)).rejects.toBeInstanceOf(DataIntegrityError);
  });
});

describe("repo decks — lectures et suppression", () => {
  it("devrait renvoyer le deck avec le nom du thème, la charte et le gabarit du programme", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");
    const deck = await decks.getDeck(a.id, deckId);
    expect(deck.themeName).toBe("Un");
    expect(deck.program).toEqual({ id: programId, name: "Programme d'essai", brand: makeBrand(), template: makeTemplate() });
  });

  it("devrait lister uniquement les decks finaux, du plus récent au plus ancien", async () => {
    const { a, programId, themeId, otherThemeId } = await ownedSetup();
    await decks.upsertSkeleton(a.id, themeId, makeConformingDeck());
    const first = await decks.createFinalDeck(a.id, { programId, themeId, problem: "Première", spec: makeConformingDeck() });
    // Horodatage explicite : l'ordre ne doit pas dépendre de deux inserts dans la même milliseconde.
    await db().deck.update({ where: { id: first.deckId }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const second = await decks.createFinalDeck(a.id, { programId, themeId: otherThemeId, problem: "Seconde", spec: makeConformingDeck() });
    const list = await decks.listFinalDecks(a.id, programId);
    expect(list.map((d) => [d.id, d.themeName, d.problem])).toEqual([
      [second.deckId, "Deux", "Seconde"],
      [first.deckId, "Un", "Première"],
    ]);
  });

  it("devrait supprimer le deck puis lever NotFoundError au second appel", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const deckId = await seedDeck(programId, themeId, "FINAL");
    expect(await decks.deleteDeck(a.id, deckId)).toEqual({ programId, themeId });
    await expect(decks.deleteDeck(a.id, deckId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deck.count({ where: { id: deckId } })).toBe(0);
  });
});
