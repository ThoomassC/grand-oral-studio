import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ConflictError } from "@/server/errors";
import * as programs from "@/server/repo/programs";
import * as themes from "@/server/repo/themes";
import { makeBrand, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

/**
 * Concurrence optimiste : deux onglets (ou deux membres) partent de la même
 * version ; le second enregistrement est refusé au lieu d'écraser le premier.
 * Jetons : apparence → brandSavedAt, trame → templateSavedAt, sujet → Theme.updatedAt.
 */

async function savedAt(programId: string) {
  return db().program.findUniqueOrThrow({
    where: { id: programId },
    select: { brandSavedAt: true, templateSavedAt: true, brand: true, template: true },
  });
}

describe("concurrence optimiste — sujet (Theme.updatedAt)", () => {
  it("devrait refuser l'enregistrement d'un sujet modifié entre-temps, sans rien écrire", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Énergie")]);
    const loaded = (await themes.listThemes(a.id, programId))[0]!;

    // Onglet 1 enregistre avec le jeton reçu au chargement.
    const first = await themes.updateTheme(a.id, themeId!, themeInput("Énergie (onglet 1)"), loaded.updatedAt);
    expect(first.name).toBe("Énergie (onglet 1)");
    expect(first.updatedAt).not.toBe(loaded.updatedAt);

    // Onglet 2 part de la même version : conflit, message clair qui invite à recharger.
    const error = await themes
      .updateTheme(a.id, themeId!, themeInput("Énergie (onglet 2)"), loaded.updatedAt)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).userMessage).toMatch(/Rechargez la page/);
    const row = await db().theme.findUniqueOrThrow({ where: { id: themeId! } });
    expect(row.name).toBe("Énergie (onglet 1)");
  });

  it("devrait accepter des enregistrements successifs avec le jeton renvoyé à chaque fois", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Énergie")]);
    const loaded = (await themes.listThemes(a.id, programId))[0]!;
    const v1 = await themes.updateTheme(a.id, themeId!, themeInput("V1"), loaded.updatedAt);
    const v2 = await themes.updateTheme(a.id, themeId!, themeInput("V2"), v1.updatedAt);
    expect(v2.name).toBe("V2");
  });

  it("sans jeton (formulaires antérieurs) : enregistre sans contrôle", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Énergie")]);
    await themes.updateTheme(a.id, themeId!, themeInput("V1"));
    await expect(themes.updateTheme(a.id, themeId!, themeInput("V2"))).resolves.toMatchObject({ name: "V2" });
  });

  it("modifier un autre sujet ou réordonner ne périme pas le jeton d'un sujet", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [first, second] = await seedThemes(programId, [themeInput("Un"), themeInput("Deux")]);
    const loaded = await themes.listThemes(a.id, programId);
    await themes.updateTheme(a.id, second!, themeInput("Deux bis"), loaded[1]!.updatedAt);
    await themes.reorderThemes(a.id, programId, [second!, first!]);
    await expect(themes.updateTheme(a.id, first!, themeInput("Un bis"), loaded[0]!.updatedAt)).resolves.toMatchObject({
      name: "Un bis",
    });
  });
});

describe("concurrence optimiste — apparence (brandSavedAt)", () => {
  it("devrait refuser une apparence enregistrée entre-temps, sans rien écrire", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    // Jamais enregistrée : le jeton est null.
    const tab1 = await programs.updateBrand(a.id, programId, makeBrand({ name: "Onglet 1" }), null);
    expect(tab1.brandSavedAt).toEqual(expect.any(String));

    const error = await programs
      .updateBrand(a.id, programId, makeBrand({ name: "Onglet 2" }), null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).userMessage).toMatch(/apparence[^]*Rechargez la page/);
    const row = await savedAt(programId);
    expect((row.brand as { name: string }).name).toBe("Onglet 1");
    expect(row.brandSavedAt?.toISOString()).toBe(tab1.brandSavedAt);
  });

  it("devrait accepter l'enregistrement avec le jeton à jour, et renvoyer le nouveau", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const v1 = await programs.updateBrand(a.id, programId, makeBrand({ name: "V1" }), null);
    const v2 = await programs.updateBrand(a.id, programId, makeBrand({ name: "V2" }), v1.brandSavedAt);
    expect(new Date(v2.brandSavedAt).getTime()).toBeGreaterThanOrEqual(new Date(v1.brandSavedAt).getTime());
    expect((await savedAt(programId)).brandSavedAt?.toISOString()).toBe(v2.brandSavedAt);
  });

  it("enregistrer la trame ne périme pas le jeton de l'apparence", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const v1 = await programs.updateBrand(a.id, programId, makeBrand({ name: "V1" }), null);
    await programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 12 }), null);
    await expect(programs.updateBrand(a.id, programId, makeBrand({ name: "V2" }), v1.brandSavedAt)).resolves.toBeDefined();
  });
});

describe("concurrence optimiste — trame (templateSavedAt)", () => {
  it("devrait refuser une trame enregistrée entre-temps, sans rien écrire", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const v1 = await programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 11 }), null);
    await programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 12 }), v1.templateSavedAt);

    const error = await programs
      .updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 13 }), v1.templateSavedAt)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).userMessage).toMatch(/trame[^]*Rechargez la page/);
    expect((await savedAt(programId)).template).toMatchObject({ durationMinutes: 12 });
  });

  it("modifier un sujet ne crée PAS de conflit sur la trame (Program.updatedAt n'est pas le jeton)", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Énergie")]);
    const v1 = await programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 11 }), null);
    const before = await db().program.findUniqueOrThrow({ where: { id: programId }, select: { updatedAt: true } });

    await themes.updateTheme(a.id, themeId!, themeInput("Énergie renommée"));
    const after = await db().program.findUniqueOrThrow({ where: { id: programId }, select: { updatedAt: true } });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());

    await expect(
      programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 14 }), v1.templateSavedAt),
    ).resolves.toBeDefined();
    await expect(programs.updateBrand(a.id, programId, makeBrand({ name: "Après sujet" }), null)).resolves.toBeDefined();
  });

  it("sans jeton (import appliqué, modèle partagé) : enregistre sans contrôle", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 11 }));
    await expect(programs.updateTemplate(a.id, programId, makeTemplate({ durationMinutes: 12 }))).resolves.toBeDefined();
  });
});
