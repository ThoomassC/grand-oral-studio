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

  it("devrait joindre au deck final le squelette de son thème (relecture : contrôle de recopie), et rien à un squelette", async () => {
    const { a, programId, themeId, otherThemeId } = await ownedSetup();
    const skeleton = makeConformingDeck();
    skeleton.slides[1] = { ...skeleton.slides[1]!, title: "Diapo du squelette" };
    const { deckId: skeletonId } = await decks.upsertSkeleton(a.id, themeId, skeleton);
    const finalId = await seedDeck(programId, themeId, "FINAL");
    const orphanId = await seedDeck(programId, otherThemeId, "FINAL");
    expect((await decks.getDeck(a.id, finalId)).skeletonSpec).toEqual(skeleton);
    expect((await decks.getDeck(a.id, orphanId)).skeletonSpec).toBeNull();
    expect((await decks.getDeck(a.id, skeletonId)).skeletonSpec).toBeNull();
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

describe("repo decks — decks finaux sans sujet", () => {
  it("devrait créer un deck final sans sujet et le relire sans nom de sujet ni squelette", async () => {
    const { a, programId } = await ownedSetup();
    const { deckId } = await decks.createFinalDeck(a.id, {
      programId,
      themeId: null,
      problem: "Une problématique",
      spec: makeConformingDeck(),
      engine: "free",
    });

    const row = await db().deck.findUniqueOrThrow({ where: { id: deckId }, select: { themeId: true, kind: true } });
    expect(row).toEqual({ themeId: null, kind: "FINAL" });
    const deck = await decks.getDeck(a.id, deckId);
    expect(deck).toMatchObject({ themeId: null, themeName: null, skeletonSpec: null, engine: "free" });
    expect((await decks.listFinalDecks(a.id, programId)).map((d) => [d.id, d.themeId, d.themeName])).toEqual([
      [deckId, null, null],
    ]);
  });

  it("devrait lever NotFoundError et ne rien créer quand B crée un deck sans sujet dans le programme de A", async () => {
    const { b, programId } = await ownedSetup();
    await expect(
      decks.createFinalDeck(b.id, { programId, themeId: null, problem: "Une problématique", spec: makeConformingDeck() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("findRecentFinalDeck devrait distinguer « sans sujet » d'un sujet pour la même problématique", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const problem = "Même problématique";
    const withoutSubject = await decks.createFinalDeck(a.id, { programId, themeId: null, problem, spec: makeConformingDeck() });

    expect(await decks.findRecentFinalDeck(a.id, { programId, themeId: null, problem, sinceMs: 60_000 })).toEqual(withoutSubject);
    expect(await decks.findRecentFinalDeck(a.id, { programId, themeId, problem, sinceMs: 60_000 })).toBeNull();

    const withSubject = await decks.createFinalDeck(a.id, { programId, themeId, problem, spec: makeConformingDeck() });
    expect(await decks.findRecentFinalDeck(a.id, { programId, themeId, problem, sinceMs: 60_000 })).toEqual(withSubject);
    expect(await decks.findRecentFinalDeck(a.id, { programId, themeId: null, problem, sinceMs: 60_000 })).toEqual(withoutSubject);
  });

  it("ne devrait pas retrouver le deck sans sujet de A pour B", async () => {
    const { a, b, programId } = await ownedSetup();
    await decks.createFinalDeck(a.id, { programId, themeId: null, problem: "Même problématique", spec: makeConformingDeck() });
    expect(
      await decks.findRecentFinalDeck(b.id, { programId, themeId: null, problem: "Même problématique", sinceMs: 60_000 }),
    ).toBeNull();
  });

  it("devrait refuser en base un squelette sans sujet (CHECK Deck_skeleton_has_theme), y compris hors du code", async () => {
    const { programId } = await ownedSetup();
    const spec = JSON.stringify(makeConformingDeck());
    await expect(
      db().$executeRaw`
        INSERT INTO "Deck" ("id", "programId", "themeId", "kind", "spec", "updatedAt")
        VALUES ('squelette-orphelin', ${programId}, NULL, 'SKELETON', ${spec}::jsonb, now())`,
    ).rejects.toThrow(/Deck_skeleton_has_theme/);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait garder les decks sans sujet quand on supprime un sujet du programme", async () => {
    const { a, programId, themeId } = await ownedSetup();
    const orphan = await seedDeck(programId, null, "FINAL");
    await seedDeck(programId, themeId, "FINAL");
    await db().theme.delete({ where: { id: themeId } });
    expect((await db().deck.findMany({ where: { programId }, select: { id: true } })).map((d) => d.id)).toEqual([orphan]);
    expect((await decks.getDeck(a.id, orphan)).themeName).toBeNull();
  });

  it("devrait supprimer un deck sans sujet et renvoyer themeId null", async () => {
    const { a, programId } = await ownedSetup();
    const deckId = await seedDeck(programId, null, "FINAL");
    expect(await decks.deleteDeck(a.id, deckId)).toEqual({ programId, themeId: null });
  });
});

describe("repo decks — contexte du deck final (getFinalDeckContext)", () => {
  /** Programme de A avec deux sujets, dont un avec notes. */
  async function contextSetup() {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programId = await seedProgram(a.id);
    const [bareId, notedId] = await seedThemes(programId, [
      themeInput("Sans notes"),
      themeInput("Avec notes", ["climat"], "Chiffre clé : 42 %\nSource : ADEME"),
    ]);
    return { a, b, programId, bareId: bareId!, notedId: notedId! };
  }

  it("devrait renvoyer le sujet choisi avec ses notes, et tous les sujets du programme", async () => {
    const { a, programId, notedId } = await contextSetup();
    const context = await decks.getFinalDeckContext(a.id, programId, notedId);
    expect(context.subject).toEqual({
      id: notedId,
      name: "Avec notes",
      description: "Description de Avec notes",
      keywords: ["climat"],
      notes: "Chiffre clé : 42 %\nSource : ADEME",
    });
    expect(context.ctx.themes.map((t) => [t.name, t.notes])).toEqual([
      ["Sans notes", ""],
      ["Avec notes", "Chiffre clé : 42 %\nSource : ADEME"],
    ]);
    expect(context.programId).toBe(programId);
    expect(context.brand).toEqual(makeBrand());
    expect(context.ctx.template).toEqual(makeTemplate());
  });

  it("devrait renvoyer subject null quand aucun sujet n'est choisi", async () => {
    const { a, programId } = await contextSetup();
    const context = await decks.getFinalDeckContext(a.id, programId, null);
    expect(context.subject).toBeNull();
    expect(context.ctx.themes).toHaveLength(2);
  });

  it("devrait accepter un programme sans aucun sujet", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const context = await decks.getFinalDeckContext(a.id, programId, null);
    expect(context).toMatchObject({ programId, subject: null, ctx: { themes: [] } });
  });

  it("devrait lever NotFoundError(sujet) pour un sujet d'un autre programme du même utilisateur", async () => {
    const { a, programId } = await contextSetup();
    const other = await seedProgram(a.id, "Autre");
    const [foreign] = await seedThemes(other, [themeInput("Ailleurs")]);
    const error = await decks.getFinalDeckContext(a.id, programId, foreign!).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).userMessage).toBe("Ce sujet est introuvable.");
  });

  it("devrait lever NotFoundError(sujet) pour un sujet inexistant", async () => {
    const { a, programId } = await contextSetup();
    await expect(decks.getFinalDeckContext(a.id, programId, "inexistant")).rejects.toThrow("Ce sujet est introuvable.");
  });

  it("devrait lever NotFoundError(projet) quand B demande le contexte du programme de A, avec ou sans sujet", async () => {
    const { b, programId, notedId } = await contextSetup();
    await expect(decks.getFinalDeckContext(b.id, programId, null)).rejects.toThrow("Ce projet est introuvable.");
    await expect(decks.getFinalDeckContext(b.id, programId, notedId)).rejects.toThrow("Ce projet est introuvable.");
  });
});
