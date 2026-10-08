import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { DataIntegrityError, NotFoundError } from "@/server/errors";
import * as programs from "@/server/repo/programs";
import { purgeTrash } from "@/server/repo/trash";
import { makeBrand, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

describe("repo programmes — autorisation", () => {
  it("devrait lever NotFoundError quand B lit le programme de A", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programId = await seedProgram(a.id);
    await expect(programs.getProgram(b.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ne devrait pas lister les programmes de A pour B", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    await seedProgram(a.id);
    expect(await programs.listPrograms(b.id)).toEqual([]);
  });

  it.each([
    { name: "updateProgramMeta", run: (u: string, p: string) => programs.updateProgramMeta(u, p, { name: "Piraté", description: "" }) },
    { name: "updateBrand", run: (u: string, p: string) => programs.updateBrand(u, p, makeBrand({ name: "Piratée" })) },
    { name: "updateTemplate", run: (u: string, p: string) => programs.updateTemplate(u, p, makeTemplate({ durationMinutes: 5 })) },
    { name: "deleteProgram", run: (u: string, p: string) => programs.deleteProgram(u, p) },
    { name: "duplicateProgram", run: (u: string, p: string) => programs.duplicateProgram(u, p) },
  ])("devrait lever NotFoundError et ne rien modifier quand B appelle $name sur le programme de A", async ({ run }) => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programId = await seedProgram(a.id);
    const before = await programs.getProgram(a.id, programId);

    await expect(run(b.id, programId)).rejects.toBeInstanceOf(NotFoundError);

    expect(await programs.getProgram(a.id, programId)).toEqual(before);
    expect(await db().program.count({ where: { ownerId: b.id } })).toBe(0);
  });

  it("devrait lever NotFoundError quand le programme n'existe pas", async () => {
    const a = await createUser("a");
    await expect(programs.getProgram(a.id, "inexistant")).rejects.toBeInstanceOf(NotFoundError);
    await expect(programs.deleteProgram(a.id, "inexistant")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("repo programmes — cycle de vie", () => {
  it("devrait relire la charte et le gabarit tels qu'enregistrés", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const detail = await programs.getProgram(a.id, programId);
    expect(detail.brand).toEqual(makeBrand());
    expect(detail.template).toEqual(makeTemplate());
    expect(detail.themes).toEqual([]);
  });

  it("devrait mettre à jour nom, charte et gabarit pour le propriétaire", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await programs.updateProgramMeta(a.id, programId, { name: "Nouveau nom", description: "Desc" });
    await programs.updateBrand(a.id, programId, makeBrand({ name: "Autre charte" }));
    await programs.updateTemplate(a.id, programId, makeTemplate({ format: "4:3" }));
    const detail = await programs.getProgram(a.id, programId);
    expect(detail.name).toBe("Nouveau nom");
    expect(detail.brand.name).toBe("Autre charte");
    expect(detail.template.format).toBe("4:3");
  });

  it("devrait compter les thèmes dans la liste des programmes", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await seedThemes(programId, [themeInput("Un"), themeInput("Deux")]);
    expect((await programs.listPrograms(a.id)).map((p) => p.themeCount)).toEqual([2]);
  });
});

describe("repo programmes — compteur de decks finaux", () => {
  it("devrait compter tous les decks finaux du programme, y compris ceux sans sujet, et pas les squelettes", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [t1] = await seedThemes(programId, [themeInput("Un")]);
    await seedDeck(programId, t1!, "SKELETON");
    await seedDeck(programId, t1!, "FINAL");
    await seedDeck(programId, null, "FINAL");
    await seedDeck(programId, null, "FINAL");

    const detail = await programs.getProgram(a.id, programId);

    expect(detail.finalDeckCount).toBe(3);
    // Le compteur par sujet, lui, ne voit que les decks de ce sujet.
    expect(detail.themes.map((t) => t.finalDeckCount)).toEqual([1]);
  });

  it("devrait valoir 0 pour un projet sans deck final", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    expect((await programs.getProgram(a.id, programId)).finalDeckCount).toBe(0);
  });
});

describe("repo programmes — suppression en cascade", () => {
  it("devrait supprimer thèmes et decks quand on supprime le programme", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [t1, t2] = await seedThemes(programId, [themeInput("Un"), themeInput("Deux")]);
    await seedDeck(programId, t1!, "SKELETON");
    await seedDeck(programId, t2!, "FINAL");
    await seedDeck(programId, null, "FINAL");

    await programs.deleteProgram(a.id, programId);
    // v1.2 : corbeille d'abord ; la cascade a lieu à la purge (> 1 h, cf. undo.int.test.ts).
    await db().program.update({ where: { id: programId }, data: { deletedAt: new Date(Date.now() - 2 * 3600 * 1000) } });
    await purgeTrash();

    expect(await db().theme.count({ where: { programId } })).toBe(0);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("devrait supprimer programmes, thèmes et decks quand on supprime l'utilisateur", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [t1] = await seedThemes(programId, [themeInput("Un")]);
    await seedDeck(programId, t1!, "FINAL");

    await db().user.delete({ where: { id: a.id } });

    expect(await db().program.count({ where: { id: programId } })).toBe(0);
    expect(await db().theme.count({ where: { programId } })).toBe(0);
    expect(await db().deck.count({ where: { programId } })).toBe(0);
  });

  it("ne devrait pas toucher aux programmes d'un autre utilisateur", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const programA = await seedProgram(a.id);
    const programB = await seedProgram(b.id);
    await seedThemes(programB, [themeInput("Un")]);
    await programs.deleteProgram(a.id, programA);
    expect(await db().theme.count({ where: { programId: programB } })).toBe(1);
  });
});

describe("repo programmes — duplication", () => {
  it("devrait copier thèmes et squelettes mais pas les decks finaux", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id, "Source");
    const [t1, t2] = await seedThemes(programId, [themeInput("Un", ["x"]), themeInput("Deux")]);
    await seedDeck(programId, t1!, "SKELETON");
    await seedDeck(programId, t2!, "FINAL");

    const { id: copyId } = await programs.duplicateProgram(a.id, programId);
    const copy = await programs.getProgram(a.id, copyId);

    expect(copy.name).toBe("Source (copie)");
    expect(copy.themes.map((t) => [t.name, t.position, t.keywords])).toEqual([
      ["Un", 0, ["x"]],
      ["Deux", 1, []],
    ]);
    expect(copy.themes.map((t) => t.skeleton !== null)).toEqual([true, false]);
    expect(await db().deck.count({ where: { programId: copyId, kind: "FINAL" } })).toBe(0);
  });

  it("devrait recopier les notes des sujets", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id, "Source");
    await seedThemes(programId, [themeInput("Un", [], "Notes de un\nSource : INSEE"), themeInput("Deux")]);

    const { id: copyId } = await programs.duplicateProgram(a.id, programId);
    const copy = await programs.getProgram(a.id, copyId);

    expect(copy.themes.map((t) => [t.name, t.notes])).toEqual([
      ["Un", "Notes de un\nSource : INSEE"],
      ["Deux", ""],
    ]);
  });

  it("ne devrait pas copier les decks finaux sans sujet", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id, "Source");
    await seedDeck(programId, null, "FINAL");
    const { id: copyId } = await programs.duplicateProgram(a.id, programId);
    expect(await db().deck.count({ where: { programId: copyId } })).toBe(0);
  });

  it("devrait garder un nom d'au plus 120 caractères quand le nom source est déjà au maximum", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id, "N".repeat(120));
    const { id } = await programs.duplicateProgram(a.id, programId);
    const copy = await programs.getProgram(a.id, id);
    expect(copy.name.length).toBeLessThanOrEqual(120);
    expect(copy.name.endsWith(" (copie)")).toBe(true);
  });
});

describe("repo programmes — validation zod des JSON", () => {
  it("devrait refuser d'écrire une charte hors schéma et ne rien créer", async () => {
    const a = await createUser("a");
    const badBrand = { ...makeBrand(), colors: { ...makeBrand().colors, primary: "rouge" } };
    await expect(
      programs.createProgram(a.id, { name: "Essai", description: "", brand: badBrand, template: makeTemplate() }),
    ).rejects.toBeInstanceOf(DataIntegrityError);
    expect(await db().program.count({ where: { ownerId: a.id } })).toBe(0);
  });

  it("devrait refuser de mettre à jour un gabarit hors schéma et garder l'ancien", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await expect(
      programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 500 })),
    ).rejects.toBeInstanceOf(DataIntegrityError);
    expect((await programs.getProgram(a.id, programId)).template.durationMinutes).toBe(20);
  });

  it("JSON stocké corrompu : getProgram se replie sur le défaut (cf. tolerant-reads), la lecture stricte lève DataIntegrityError", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await db().program.update({ where: { id: programId }, data: { brand: { name: 42 } } });
    await expect(programs.getProgram(a.id, programId)).resolves.toMatchObject({ degraded: ["brand"] });
    await expect(programs.getProgramBrand(a.id, programId, "editor")).rejects.toBeInstanceOf(DataIntegrityError);
  });
});
