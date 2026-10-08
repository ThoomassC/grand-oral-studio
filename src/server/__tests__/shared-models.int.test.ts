import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ForbiddenError, LimitExceededError, NotFoundError } from "@/server/errors";
import { getProgram } from "@/server/repo/programs";
import * as models from "@/server/repo/shared-models";
import { makeBrand, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedMember, seedProgram } from "./helpers";

setupTestDatabase();

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

async function programWithBrand(ownerId: string): Promise<string> {
  const programId = await seedProgram(ownerId);
  await db().program.update({
    where: { id: programId },
    data: { brand: makeBrand({ name: "Charte école", logoDataUrl: LOGO }), template: makeTemplate({ durationMinutes: 15 }) },
  });
  return programId;
}

describe("publishModel", () => {
  it("devrait publier l'apparence d'un projet pour son propriétaire", async () => {
    const owner = await createUser("alice");
    const programId = await programWithBrand(owner.id);

    const { id } = await models.publishModel(owner.id, programId, "brand", "  Charte de l'école  ");

    const row = await db().sharedModel.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ authorId: owner.id, kind: "BRAND", name: "Charte de l'école" });
    expect(row.payload).toMatchObject({ name: "Charte école", logoDataUrl: LOGO });
  });

  it("devrait refuser un éditeur (403) : publier à toute l'instance revient au propriétaire", async () => {
    const [owner, editor] = [await createUser("alice"), await createUser("bob")];
    const programId = await programWithBrand(owner.id);
    await seedMember(programId, editor.id, "EDITOR");

    await expect(models.publishModel(editor.id, programId, "brand", "Copie")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(models.publishModel(editor.id, programId, "template", "Copie")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db().sharedModel.count()).toBe(0);
  });

  it("devrait publier la trame d'un projet pour le propriétaire", async () => {
    const owner = await createUser("alice");
    const programId = await programWithBrand(owner.id);
    const { id } = await models.publishModel(owner.id, programId, "template", "Trame 15 min");
    const row = await db().sharedModel.findUniqueOrThrow({ where: { id } });
    expect(row.kind).toBe("TEMPLATE");
    expect(row.payload).toMatchObject({ durationMinutes: 15 });
  });

  it("devrait refuser un lecteur (403) et un inconnu (404) sans rien publier", async () => {
    const [owner, viewer, stranger] = [await createUser("alice"), await createUser("vic"), await createUser("eve")];
    const programId = await programWithBrand(owner.id);
    await seedMember(programId, viewer.id, "VIEWER");

    await expect(models.publishModel(viewer.id, programId, "brand", "Copie")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(models.publishModel(stranger.id, programId, "brand", "Copie")).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().sharedModel.count()).toBe(0);
  });

  it("devrait refuser un projet à la corbeille (404)", async () => {
    const owner = await createUser("alice");
    const programId = await programWithBrand(owner.id);
    await db().program.update({ where: { id: programId }, data: { deletedAt: new Date() } });
    await expect(models.publishModel(owner.id, programId, "brand", "Copie")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait renvoyer le même modèle quand la publication est rejouée aussitôt (double clic)", async () => {
    const owner = await createUser("alice");
    const programId = await programWithBrand(owner.id);
    const [a, b] = await Promise.all([
      models.publishModel(owner.id, programId, "brand", "Charte"),
      models.publishModel(owner.id, programId, "brand", "Charte"),
    ]);
    expect(a.id).toBe(b.id);
    expect(await db().sharedModel.count()).toBe(1);
  });

  it("devrait plafonner le nombre de modèles par auteur", async () => {
    const owner = await createUser("alice");
    const programId = await programWithBrand(owner.id);
    await db().sharedModel.createMany({
      data: Array.from({ length: models.MAX_MODELS_PER_AUTHOR }, (_, i) => ({
        authorId: owner.id,
        kind: "BRAND",
        name: `Modèle ${i}`,
        payload: makeBrand(),
      })),
    });
    await expect(models.publishModel(owner.id, programId, "brand", "Un de trop")).rejects.toBeInstanceOf(LimitExceededError);
  });
});

describe("listModels", () => {
  it("devrait lister les modèles de toute l'instance, auteur par son nom, sans le logo", async () => {
    const [alice, bob] = [await createUser("alice"), await createUser("bob")];
    const programId = await programWithBrand(alice.id);
    await models.publishModel(alice.id, programId, "brand", "Charte d'Alice");
    await models.publishModel(alice.id, programId, "template", "Trame d'Alice");

    const all = await models.listModels(bob.id);
    expect(all.map((m) => m.name).sort()).toEqual(["Charte d'Alice", "Trame d'Alice"]);
    expect(all.every((m) => m.authorName === "alice" && !m.isMine)).toBe(true);
    expect(JSON.stringify(all)).not.toContain("base64");
    expect(JSON.stringify(all)).not.toContain(alice.id);

    const brands = await models.listModels(alice.id, "brand");
    expect(brands).toHaveLength(1);
    expect(brands[0]).toMatchObject({ kind: "brand", isMine: true, preview: { kind: "brand", hasLogo: true } });

    const templates = await models.listModels(alice.id, "template");
    expect(templates[0]).toMatchObject({ kind: "template", preview: { kind: "template", durationMinutes: 15 } });
  });
});

describe("applyModel", () => {
  it("devrait remplacer l'apparence du projet cible (éditeur) et dater brandSavedAt", async () => {
    const [alice, bob] = [await createUser("alice"), await createUser("bob")];
    const source = await programWithBrand(alice.id);
    const { id: modelId } = await models.publishModel(alice.id, source, "brand", "Charte d'Alice");
    const target = await seedProgram(bob.id, "Projet de Bob");

    expect(await models.applyModel(bob.id, target, modelId)).toEqual({ kind: "brand" });

    const detail = await getProgram(bob.id, target);
    expect(detail.brand).toEqual(makeBrand({ name: "Charte école", logoDataUrl: LOGO }));
    expect(detail.brandSavedAt).not.toBeNull();
    expect(detail.templateSavedAt).toBeNull();
  });

  it("devrait remplacer la trame du projet cible et dater templateSavedAt", async () => {
    const [alice, bob] = [await createUser("alice"), await createUser("bob")];
    const source = await programWithBrand(alice.id);
    const { id: modelId } = await models.publishModel(alice.id, source, "template", "Trame");
    const target = await seedProgram(bob.id, "Projet de Bob");

    await models.applyModel(bob.id, target, modelId);

    const detail = await getProgram(bob.id, target);
    expect(detail.template.durationMinutes).toBe(15);
    expect(detail.templateSavedAt).not.toBeNull();
  });

  it("devrait refuser un lecteur du projet cible (403) et un inconnu (404), sans rien modifier", async () => {
    const [alice, viewer, stranger] = [await createUser("alice"), await createUser("vic"), await createUser("eve")];
    const programId = await seedProgram(alice.id);
    await seedMember(programId, viewer.id, "VIEWER");
    const source = await programWithBrand(alice.id);
    const { id: modelId } = await models.publishModel(alice.id, source, "brand", "Charte");

    await expect(models.applyModel(viewer.id, programId, modelId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(models.applyModel(stranger.id, programId, modelId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getProgram(alice.id, programId)).brandSavedAt).toBeNull();
  });

  it("devrait répondre 404 pour un modèle inconnu", async () => {
    const alice = await createUser("alice");
    const programId = await seedProgram(alice.id);
    await expect(models.applyModel(alice.id, programId, "inexistant")).rejects.toMatchObject({ status: 404 });
  });
});

describe("deleteModel", () => {
  it("devrait laisser l'auteur seul retirer son modèle", async () => {
    const [alice, bob] = [await createUser("alice"), await createUser("bob")];
    const programId = await programWithBrand(alice.id);
    const { id } = await models.publishModel(alice.id, programId, "brand", "Charte");

    await expect(models.deleteModel(bob.id, id)).rejects.toMatchObject({ status: 403 });
    expect(await db().sharedModel.count()).toBe(1);

    await models.deleteModel(alice.id, id);
    expect(await db().sharedModel.count()).toBe(0);
    await expect(models.deleteModel(alice.id, id)).rejects.toMatchObject({ status: 404 });
  });
});
