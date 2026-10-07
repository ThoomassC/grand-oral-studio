import { describe, expect, it } from "vitest";
import { ThemeInputSchema, type Slide } from "@/domain/schemas";
import { db } from "@/server/db/client";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import type { ProgramRole } from "@/server/repo/access";
import * as decks from "@/server/repo/decks";
import * as programs from "@/server/repo/programs";
import { getProfile } from "@/server/repo/profile";
import * as themes from "@/server/repo/themes";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

/**
 * Matrice d'accès par rôle (v1.2) : lecteur = lire, exporter, dupliquer vers son compte ;
 * éditeur = apparence, trame, sujets, génération, édition/suppression de diaporama ;
 * propriétaire = supprimer/restaurer le projet. Inconnu → 404 (l'existence n'est jamais
 * révélée), rôle insuffisant → 403, projet ou deck à la corbeille → invisible.
 */

const editedSlide: Slide = {
  layout: "content",
  sectionId: "part1",
  title: "Diapo modifiée",
  subtitle: "",
  bullets: ["Nouvelle puce"],
  notes: "Nouvelle note",
};

type Who = "owner" | "editor" | "viewer" | "stranger";
const RANK: Record<ProgramRole, number> = { viewer: 1, editor: 2, owner: 3 };

async function sharedSetup() {
  const users = {
    owner: await createUser("owner"),
    editor: await createUser("editor"),
    viewer: await createUser("viewer"),
    stranger: await createUser("stranger"),
  };
  const programId = await seedProgram(users.owner.id, "Projet partagé");
  const [themeId, otherThemeId] = await seedThemes(programId, [themeInput("Énergie"), themeInput("Santé")]);
  const deckId = await seedDeck(programId, themeId!, "FINAL");
  await seedMember(programId, users.editor.id, "EDITOR");
  await seedMember(programId, users.viewer.id, "VIEWER");
  return { users, programId, themeId: themeId!, otherThemeId: otherThemeId!, deckId };
}
type Setup = Awaited<ReturnType<typeof sharedSetup>>;

interface Case {
  name: string;
  min: ProgramRole;
  run: (userId: string, s: Setup) => Promise<unknown>;
  /** Fonction dont l'objet est justement à la corbeille (restauration) : pas de cas « projet supprimé ». */
  restores?: boolean;
}

const softDeleteDeck = (deckId: string) => db().deck.update({ where: { id: deckId }, data: { deletedAt: new Date() } });
const softDeleteProgram = (programId: string) =>
  db().program.update({ where: { id: programId }, data: { deletedAt: new Date() } });

const CASES: Case[] = [
  // Lecteur
  { name: "getProgram", min: "viewer", run: (u, s) => programs.getProgram(u, s.programId) },
  { name: "listThemes", min: "viewer", run: (u, s) => themes.listThemes(u, s.programId) },
  { name: "getDeck", min: "viewer", run: (u, s) => decks.getDeck(u, s.deckId) },
  { name: "listFinalDecks", min: "viewer", run: (u, s) => decks.listFinalDecks(u, s.programId) },
  { name: "duplicateProgram", min: "viewer", run: (u, s) => programs.duplicateProgram(u, s.programId) },
  { name: "assertProgramAccess(viewer)", min: "viewer", run: (u, s) => programs.assertProgramAccess(u, s.programId, "viewer") },
  { name: "getProgramTemplate(viewer)", min: "viewer", run: (u, s) => programs.getProgramTemplate(u, s.programId, "viewer") },
  // Éditeur
  { name: "assertProgramAccess(editor)", min: "editor", run: (u, s) => programs.assertProgramAccess(u, s.programId, "editor") },
  { name: "getProgramTemplate(editor)", min: "editor", run: (u, s) => programs.getProgramTemplate(u, s.programId, "editor") },
  { name: "getProgramBrand(editor)", min: "editor", run: (u, s) => programs.getProgramBrand(u, s.programId, "editor") },
  {
    name: "updateProgramMeta",
    min: "editor",
    run: (u, s) => programs.updateProgramMeta(u, s.programId, { name: "Renommé", description: "" }),
  },
  { name: "updateBrand", min: "editor", run: (u, s) => programs.updateBrand(u, s.programId, makeBrand({ name: "Autre" })) },
  {
    name: "updateTemplate",
    min: "editor",
    run: (u, s) => programs.updateTemplate(u, s.programId, makeTemplate({ durationMinutes: 7 })),
  },
  { name: "getGenerationContext", min: "editor", run: (u, s) => decks.getGenerationContext(u, s.programId) },
  { name: "getFinalDeckContext", min: "editor", run: (u, s) => decks.getFinalDeckContext(u, s.programId, s.themeId) },
  {
    name: "createFinalDeck",
    min: "editor",
    run: (u, s) =>
      decks.createFinalDeck(u, { programId: s.programId, themeId: s.themeId, problem: "Une problématique", spec: makeConformingDeck() }),
  },
  { name: "updateDeckSlide", min: "editor", run: (u, s) => decks.updateDeckSlide(u, s.deckId, 1, editedSlide) },
  { name: "deleteDeck", min: "editor", run: (u, s) => decks.deleteDeck(u, s.deckId) },
  {
    name: "restoreDeck",
    min: "editor",
    restores: true,
    run: async (u, s) => {
      await softDeleteDeck(s.deckId);
      return decks.restoreDeck(u, s.deckId);
    },
  },
  { name: "addTheme", min: "editor", run: (u, s) => themes.addTheme(u, s.programId, themeInput("Climat")) },
  { name: "updateTheme", min: "editor", run: (u, s) => themes.updateTheme(u, s.themeId, themeInput("Énergie (bis)")) },
  { name: "deleteTheme", min: "editor", run: (u, s) => themes.deleteTheme(u, s.themeId) },
  { name: "reorderThemes", min: "editor", run: (u, s) => themes.reorderThemes(u, s.programId, [s.otherThemeId, s.themeId]) },
  { name: "importThemes", min: "editor", run: (u, s) => themes.importThemes(u, s.programId, [themeInput("Climat")]) },
  // Propriétaire
  { name: "deleteProgram", min: "owner", run: (u, s) => programs.deleteProgram(u, s.programId) },
  {
    name: "restoreProgram",
    min: "owner",
    restores: true,
    run: async (u, s) => {
      await softDeleteProgram(s.programId);
      return programs.restoreProgram(u, s.programId);
    },
  },
];

const ROLE_CASES = CASES.flatMap((c) =>
  (["owner", "editor", "viewer", "stranger"] as const).map((who: Who) => ({ ...c, who })),
);

describe("matrice d'accès — chaque fonction de repo, chaque rôle", () => {
  it.each(ROLE_CASES)("$name ($min requis) appelé par $who", async ({ run, min, who }) => {
    const s = await sharedSetup();
    const promise = run(s.users[who].id, s);
    if (who === "stranger") {
      await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    } else if (RANK[who] >= RANK[min]) {
      await expect(promise).resolves.not.toThrow();
    } else {
      await expect(promise).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("ForbiddenError porte le code FORBIDDEN, le statut 403 et un message français", () => {
    const error = new ForbiddenError();
    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
    expect(error.userMessage).toBe("Vous n'avez pas les droits pour cette action sur ce projet.");
  });

  it.each(CASES.filter((c) => !c.restores))(
    "$name : un projet à la corbeille est introuvable, même pour son propriétaire",
    async ({ run }) => {
      const s = await sharedSetup();
      await softDeleteProgram(s.programId);
      await expect(run(s.users.owner.id, s)).rejects.toBeInstanceOf(NotFoundError);
      await expect(run(s.users.editor.id, s)).rejects.toBeInstanceOf(NotFoundError);
    },
  );

  it.each(CASES)("$name : une ligne membre parasite du propriétaire (VIEWER) est ignorée", async ({ run }) => {
    const s = await sharedSetup();
    await seedMember(s.programId, s.users.owner.id, "VIEWER");
    await expect(run(s.users.owner.id, s)).resolves.not.toThrow();
  });

  it.each([
    { name: "getDeck", run: (u: string, s: Setup) => decks.getDeck(u, s.deckId) },
    { name: "updateDeckSlide", run: (u: string, s: Setup) => decks.updateDeckSlide(u, s.deckId, 1, editedSlide) },
    { name: "deleteDeck", run: (u: string, s: Setup) => decks.deleteDeck(u, s.deckId) },
  ])("$name : un deck à la corbeille est introuvable", async ({ run }) => {
    const s = await sharedSetup();
    await softDeleteDeck(s.deckId);
    await expect(run(s.users.owner.id, s)).rejects.toBeInstanceOf(NotFoundError);
    await expect(run(s.users.viewer.id, s)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ne modifie rien quand un rôle insuffisant est refusé", async () => {
    const s = await sharedSetup();
    const before = await programs.getProgram(s.users.owner.id, s.programId);
    await expect(programs.updateBrand(s.users.viewer.id, s.programId, makeBrand({ name: "Piratée" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(themes.deleteTheme(s.users.viewer.id, s.themeId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decks.updateDeckSlide(s.users.viewer.id, s.deckId, 1, editedSlide)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(programs.deleteProgram(s.users.editor.id, s.programId)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await programs.getProgram(s.users.owner.id, s.programId)).toEqual(before);
    expect((await decks.getDeck(s.users.owner.id, s.deckId)).spec).toEqual(makeConformingDeck());
  });

  it("une membership dans un autre projet ne donne aucun droit sur celui-ci", async () => {
    const s = await sharedSetup();
    const other = await seedProgram(s.users.owner.id, "Autre projet");
    await expect(programs.getProgram(s.users.viewer.id, other)).rejects.toBeInstanceOf(NotFoundError);
    await expect(programs.updateBrand(s.users.editor.id, other, makeBrand())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("duplicateProgram par un lecteur crée la copie dans SON compte", async () => {
    const s = await sharedSetup();
    const { id } = await programs.duplicateProgram(s.users.viewer.id, s.programId);
    const copy = await db().program.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
    expect(copy.ownerId).toBe(s.users.viewer.id);
    expect((await programs.getProgram(s.users.viewer.id, id)).role).toBe("owner");
  });
});

describe("lectures sans exception — rôle exposé, corbeille exclue", () => {
  it("listPrograms expose le rôle et le nom du propriétaire (null pour soi)", async () => {
    const s = await sharedSetup();
    const view = async (who: Who) =>
      (await programs.listPrograms(s.users[who].id)).map((p) => ({ id: p.id, role: p.role, ownerName: p.ownerName }));
    expect(await view("owner")).toEqual([{ id: s.programId, role: "owner", ownerName: null }]);
    expect(await view("editor")).toEqual([{ id: s.programId, role: "editor", ownerName: "owner" }]);
    expect(await view("viewer")).toEqual([{ id: s.programId, role: "viewer", ownerName: "owner" }]);
    expect(await view("stranger")).toEqual([]);
  });

  it("listPrograms liste ses projets et les projets partagés, une seule fois chacun, ligne parasite ignorée", async () => {
    const s = await sharedSetup();
    const own = await seedProgram(s.users.editor.id, "À moi");
    await seedMember(s.programId, s.users.owner.id, "VIEWER");
    await seedMember(own, s.users.editor.id, "VIEWER");
    const list = await programs.listPrograms(s.users.editor.id);
    expect(list.map((p) => [p.id, p.role]).sort()).toEqual([[own, "owner"], [s.programId, "editor"]].sort());
    expect((await programs.listPrograms(s.users.owner.id)).map((p) => [p.id, p.role])).toEqual([[s.programId, "owner"]]);
  });

  it("listPrograms n'affiche plus un projet à la corbeille, pour personne", async () => {
    const s = await sharedSetup();
    await softDeleteProgram(s.programId);
    for (const who of ["owner", "editor", "viewer"] as const) {
      expect(await programs.listPrograms(s.users[who].id)).toEqual([]);
    }
  });

  it("getProgram expose le rôle de l'appelant", async () => {
    const s = await sharedSetup();
    expect((await programs.getProgram(s.users.owner.id, s.programId)).role).toBe("owner");
    expect((await programs.getProgram(s.users.editor.id, s.programId)).role).toBe("editor");
    expect((await programs.getProgram(s.users.viewer.id, s.programId)).role).toBe("viewer");
  });

  it("findRecentFinalDeck : retrouvé par un éditeur, jamais par un lecteur ni un inconnu", async () => {
    const s = await sharedSetup();
    const problem = "Une problématique";
    const input = { programId: s.programId, themeId: s.themeId, problem, sinceMs: 60_000 };
    expect(await decks.findRecentFinalDeck(s.users.editor.id, input)).toEqual({ deckId: s.deckId });
    expect(await decks.findRecentFinalDeck(s.users.owner.id, input)).toEqual({ deckId: s.deckId });
    expect(await decks.findRecentFinalDeck(s.users.viewer.id, input)).toBeNull();
    expect(await decks.findRecentFinalDeck(s.users.stranger.id, input)).toBeNull();
    await softDeleteDeck(s.deckId);
    expect(await decks.findRecentFinalDeck(s.users.owner.id, input)).toBeNull();
  });

  it("getProfile ne compte que ses projets actifs (ni partagés, ni à la corbeille)", async () => {
    const s = await sharedSetup();
    await seedProgram(s.users.owner.id, "Second");
    expect((await getProfile(s.users.owner.id))?.projectCount).toBe(2);
    expect((await getProfile(s.users.editor.id))?.projectCount).toBe(0);
    await softDeleteProgram(s.programId);
    expect((await getProfile(s.users.owner.id))?.projectCount).toBe(1);
  });
});

describe("colonnes 1.2 exposées", () => {
  it("ThemeView expose problems et updatedAt (ISO)", async () => {
    const s = await sharedSetup();
    const created = await themes.addTheme(s.users.editor.id, s.programId, {
      ...themeInput("Climat"),
      problems: ["Faut-il taxer le kérosène ?"],
    });
    expect(created.problems).toEqual(["Faut-il taxer le kérosène ?"]);
    expect(new Date(created.updatedAt).toISOString()).toBe(created.updatedAt);
    const listed = await themes.listThemes(s.users.viewer.id, s.programId);
    expect(listed.find((t) => t.id === created.id)?.problems).toEqual(["Faut-il taxer le kérosène ?"]);
    expect(listed.find((t) => t.id === s.themeId)?.problems).toEqual([]);
  });

  it("ThemeInputSchema : problems facultatif, 30 au plus, 10 à 1500 caractères (points de code, comme le CHECK)", () => {
    expect(ThemeInputSchema.parse({ name: "Énergie" })).not.toHaveProperty("problems");
    expect(ThemeInputSchema.safeParse({ name: "Énergie", problems: ["trop court"] }).success).toBe(true);
    expect(ThemeInputSchema.safeParse({ name: "Énergie", problems: ["court"] }).success).toBe(false);
    expect(ThemeInputSchema.safeParse({ name: "Énergie", problems: ["x".repeat(1501)] }).success).toBe(false);
    expect(ThemeInputSchema.safeParse({ name: "Énergie", problems: Array(31).fill("Une problématique") }).success).toBe(false);
    // 10 émojis = 10 caractères pour PostgreSQL (char_length), 20 unités UTF-16.
    expect(ThemeInputSchema.safeParse({ name: "Énergie", problems: ["😀".repeat(10)] }).success).toBe(true);
    expect(ThemeInputSchema.safeParse({ name: "Énergie", problems: ["😀".repeat(5)] }).success).toBe(false);
  });

  it("updateTheme sans problems conserve les problématiques ; avec, les remplace", async () => {
    const s = await sharedSetup();
    await themes.updateTheme(s.users.owner.id, s.themeId, { ...themeInput("Énergie"), problems: ["Première problématique"] });
    const kept = await themes.updateTheme(s.users.owner.id, s.themeId, themeInput("Énergie renommée"));
    expect(kept.problems).toEqual(["Première problématique"]);
    const replaced = await themes.updateTheme(s.users.owner.id, s.themeId, { ...themeInput("Énergie"), problems: [] });
    expect(replaced.problems).toEqual([]);
  });

  it("createFinalDeck enregistre practice, prepStartedAt et createdById ; DeckView et la liste exposent practice", async () => {
    const s = await sharedSetup();
    const prepStartedAt = new Date("2026-10-07T08:00:00.000Z");
    const { deckId } = await decks.createFinalDeck(s.users.editor.id, {
      programId: s.programId,
      themeId: s.themeId,
      problem: "Entraînement",
      spec: makeConformingDeck(),
      practice: true,
      prepStartedAt,
      createdById: s.users.editor.id,
    });
    const row = await db().deck.findUniqueOrThrow({
      where: { id: deckId },
      select: { practice: true, prepStartedAt: true, createdById: true },
    });
    expect(row).toEqual({ practice: true, prepStartedAt, createdById: s.users.editor.id });
    expect((await decks.getDeck(s.users.viewer.id, deckId)).practice).toBe(true);
    const list = await decks.listFinalDecks(s.users.viewer.id, s.programId);
    expect(list.map((d) => [d.id, d.practice])).toEqual([
      [deckId, true],
      [s.deckId, false],
    ]);
  });

  it("createFinalDeck sans les nouveaux champs : practice false, prepStartedAt et createdById null", async () => {
    const s = await sharedSetup();
    const { deckId } = await decks.createFinalDeck(s.users.owner.id, {
      programId: s.programId,
      themeId: null,
      problem: "Jour J",
      spec: makeConformingDeck(),
    });
    const row = await db().deck.findUniqueOrThrow({
      where: { id: deckId },
      select: { practice: true, prepStartedAt: true, createdById: true },
    });
    expect(row).toEqual({ practice: false, prepStartedAt: null, createdById: null });
  });

  it("findRecentFinalDeck distingue un deck d'entraînement d'un deck du jour J", async () => {
    const s = await sharedSetup();
    const problem = "Même problématique";
    const practice = await decks.createFinalDeck(s.users.owner.id, {
      programId: s.programId,
      themeId: null,
      problem,
      spec: makeConformingDeck(),
      practice: true,
    });
    const base = { programId: s.programId, themeId: null, problem, sinceMs: 60_000 };
    expect(await decks.findRecentFinalDeck(s.users.owner.id, { ...base, practice: true })).toEqual(practice);
    expect(await decks.findRecentFinalDeck(s.users.owner.id, { ...base, practice: false })).toBeNull();
    expect(await decks.findRecentFinalDeck(s.users.owner.id, base)).toBeNull();
  });
});
