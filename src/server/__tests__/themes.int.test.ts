import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ConflictError, LimitExceededError, NotFoundError } from "@/server/errors";
import * as themes from "@/server/repo/themes";
import { parseThemeImport } from "@/server/theme-import";
import { MAX_THEMES_PER_PROGRAM } from "@/server/validation";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

async function positions(programId: string): Promise<{ name: string; position: number }[]> {
  return db().theme.findMany({ where: { programId }, orderBy: { position: "asc" }, select: { name: true, position: true } });
}

function parsedOrFail(text: string) {
  const result = parseThemeImport(text);
  if (!result.ok) throw new Error(`Import de test invalide : ${JSON.stringify(result.errors)}`);
  return result.themes;
}

describe("repo thèmes — autorisation", () => {
  it.each([
    { name: "addTheme", run: (u: string, p: string) => themes.addTheme(u, p, themeInput("Intrus")) },
    { name: "importThemes", run: (u: string, p: string) => themes.importThemes(u, p, [themeInput("Intrus")]) },
    { name: "reorderThemes", run: async (u: string, p: string) => themes.reorderThemes(u, p, (await positionsIds(p)).reverse()) },
  ])("devrait lever NotFoundError et ne rien écrire quand B appelle $name sur le programme de A", async ({ run }) => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programId = await seedProgram(a.id);
    await seedThemes(programId, [themeInput("Un"), themeInput("Deux")]);

    await expect(run(b.id, programId)).rejects.toBeInstanceOf(NotFoundError);

    expect(await positions(programId)).toEqual([
      { name: "Un", position: 0 },
      { name: "Deux", position: 1 },
    ]);
  });

  it.each([
    { name: "updateTheme", run: (u: string, t: string) => themes.updateTheme(u, t, themeInput("Piraté")) },
    { name: "deleteTheme", run: (u: string, t: string) => themes.deleteTheme(u, t) },
  ])("devrait lever NotFoundError et ne rien modifier quand B appelle $name sur un thème de A", async ({ run }) => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Un")]);

    await expect(run(b.id, themeId!)).rejects.toBeInstanceOf(NotFoundError);

    expect(await positions(programId)).toEqual([{ name: "Un", position: 0 }]);
  });

  // ÉCART AU CONTRAT (rouge attendu) : listThemes renvoie [] au lieu de lever NotFoundError
  // pour un programme non possédé (src/server/repo/themes.ts:47-53). Pas de fuite de données,
  // mais incohérent avec getProgram / listFinalDecks, et indiscernable d'un programme vide.
  it("devrait lever NotFoundError quand B liste les thèmes du programme de A", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programId = await seedProgram(a.id);
    await seedThemes(programId, [themeInput("Un")]);
    await expect(themes.listThemes(b.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ne devrait renvoyer aucun thème de A quand B liste le programme de A", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programId = await seedProgram(a.id);
    await seedThemes(programId, [themeInput("Un")]);
    const result = await themes.listThemes(b.id, programId).catch(() => []);
    expect(result).toEqual([]);
  });
});

async function positionsIds(programId: string): Promise<string[]> {
  const rows = await db().theme.findMany({ where: { programId }, orderBy: { position: "asc" }, select: { id: true } });
  return rows.map((r) => r.id);
}

describe("repo thèmes — ajout, modification, suppression", () => {
  it("devrait ajouter les thèmes en fin de liste", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await themes.addTheme(a.id, programId, themeInput("Un"));
    await themes.addTheme(a.id, programId, themeInput("Deux"));
    expect(await positions(programId)).toEqual([
      { name: "Un", position: 0 },
      { name: "Deux", position: 1 },
    ]);
  });

  it("devrait attribuer des positions distinctes à des ajouts concurrents", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await Promise.all(["Un", "Deux", "Trois", "Quatre", "Cinq"].map((n) => themes.addTheme(a.id, programId, themeInput(n))));
    expect((await positions(programId)).map((t) => t.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("devrait lever LimitExceededError quand le programme a déjà le maximum de thèmes", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await seedThemes(programId, Array.from({ length: MAX_THEMES_PER_PROGRAM }, (_, i) => themeInput(`Thème ${i}`)));
    await expect(themes.addTheme(a.id, programId, themeInput("De trop"))).rejects.toBeInstanceOf(LimitExceededError);
    expect(await db().theme.count({ where: { programId } })).toBe(MAX_THEMES_PER_PROGRAM);
  });

  it("devrait modifier nom, description et mots-clés sans changer la position", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [, second] = await seedThemes(programId, [themeInput("Un"), themeInput("Deux")]);
    const updated = await themes.updateTheme(a.id, second!, { name: "Renommé", description: "Neuve", keywords: ["k"] });
    expect(updated).toMatchObject({ name: "Renommé", description: "Neuve", keywords: ["k"], position: 1 });
  });

  it("devrait recompacter les positions et supprimer les decks du thème quand on le supprime", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [, second] = await seedThemes(programId, [themeInput("Un"), themeInput("Deux"), themeInput("Trois")]);
    await seedDeck(programId, second!, "SKELETON");
    await seedDeck(programId, second!, "FINAL");

    await themes.deleteTheme(a.id, second!);

    expect(await positions(programId)).toEqual([
      { name: "Un", position: 0 },
      { name: "Trois", position: 1 },
    ]);
    expect(await db().deck.count({ where: { themeId: second! } })).toBe(0);
  });
});

describe("repo thèmes — réordonnancement", () => {
  it("devrait appliquer exactement l'ordre demandé", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const ids = await seedThemes(programId, [themeInput("Un"), themeInput("Deux"), themeInput("Trois")]);
    const wanted = [ids[2]!, ids[0]!, ids[1]!];
    await themes.reorderThemes(a.id, programId, wanted);
    expect((await themes.listThemes(a.id, programId)).map((t) => [t.id, t.position])).toEqual([
      [wanted[0], 0],
      [wanted[1], 1],
      [wanted[2], 2],
    ]);
  });

  it.each([
    { cas: "un thème manquant", build: (ids: string[]) => ids.slice(1) },
    { cas: "un doublon", build: (ids: string[]) => [ids[0]!, ids[0]!, ids[1]!] },
    { cas: "un id étranger", build: (ids: string[]) => [ids[0]!, ids[1]!, "etranger"] },
  ])("devrait lever ConflictError et garder l'ordre quand la liste contient $cas", async ({ build }) => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const ids = await seedThemes(programId, [themeInput("Un"), themeInput("Deux"), themeInput("Trois")]);
    await expect(themes.reorderThemes(a.id, programId, build(ids))).rejects.toBeInstanceOf(ConflictError);
    expect(await positionsIds(programId)).toEqual(ids);
  });

  it("devrait lever ConflictError quand la liste contient un thème d'un autre programme du même utilisateur", async () => {
    const a = await createUser("a");
    const p1 = await seedProgram(a.id, "Un");
    const p2 = await seedProgram(a.id, "Deux");
    const ids = await seedThemes(p1, [themeInput("Un"), themeInput("Deux")]);
    const [foreign] = await seedThemes(p2, [themeInput("Ailleurs")]);
    await expect(themes.reorderThemes(a.id, p1, [ids[0]!, foreign!])).rejects.toBeInstanceOf(ConflictError);
    expect(await positionsIds(p1)).toEqual(ids);
  });
});

describe("repo thèmes — import", () => {
  const TEXT = "Numérique | Réseaux et données | internet, données\nVille | | urbanisme\nÉnergie";

  it("devrait créer les thèmes importés en fin de liste avec description et mots-clés", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await seedThemes(programId, [themeInput("Existant")]);

    const result = await themes.importThemes(a.id, programId, parsedOrFail(TEXT));

    expect(result).toEqual({ created: 3, skipped: [] });
    expect((await themes.listThemes(a.id, programId)).map((t) => [t.position, t.name, t.description, t.keywords])).toEqual([
      [0, "Existant", "Description de Existant", []],
      [1, "Numérique", "Réseaux et données", ["internet", "données"]],
      [2, "Ville", "", ["urbanisme"]],
      [3, "Énergie", "", []],
    ]);
  });

  it("devrait être idempotent quand on rejoue le même import", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await themes.importThemes(a.id, programId, parsedOrFail(TEXT));

    const replay = await themes.importThemes(a.id, programId, parsedOrFail(TEXT));

    expect(replay).toEqual({ created: 0, skipped: ["Numérique", "Ville", "Énergie"] });
    expect(await db().theme.count({ where: { programId } })).toBe(3);
  });

  it("devrait ignorer un thème existant à la casse et aux accents près", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await seedThemes(programId, [themeInput("Énergie")]);
    const result = await themes.importThemes(a.id, programId, parsedOrFail("energie\nCLIMAT"));
    expect(result).toEqual({ created: 1, skipped: ["energie"] });
  });

  it("devrait lever LimitExceededError et ne rien créer quand l'import dépasse le plafond du programme", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await seedThemes(programId, Array.from({ length: MAX_THEMES_PER_PROGRAM - 1 }, (_, i) => themeInput(`Thème ${i}`)));
    await expect(themes.importThemes(a.id, programId, parsedOrFail("Nouveau un\nNouveau deux"))).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    expect(await db().theme.count({ where: { programId } })).toBe(MAX_THEMES_PER_PROGRAM - 1);
  });

  it("devrait ne rien créer et ne pas échouer quand tous les thèmes existent déjà", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await seedThemes(programId, [themeInput("Un")]);
    expect(await themes.importThemes(a.id, programId, parsedOrFail("Un"))).toEqual({ created: 0, skipped: ["Un"] });
  });
});
