import { describe, expect, it } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import { db } from "@/server/db/client";
import { listPrograms } from "@/server/repo/programs";
import { createUser, setupTestDatabase } from "@/test/db";
import { makeBrand, makeConformingDeck } from "@/test/fixtures";
import { recordingLogger, seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

describe("Galerie — aperçus des projets accessibles", () => {
  it("devrait prendre la couverture du dernier diaporama modifié, hors corbeille et sans les notes", async () => {
    const user = await createUser();
    const id = await seedProgram(user.id);
    const [themeId] = await seedThemes(id, [themeInput("Énergie")]);
    const older = await seedDeck(id, null, "FINAL");
    const spec = makeConformingDeck();
    spec.slides[0] = { ...spec.slides[0]!, title: "La couverture modifiée", subtitle: "Les idées essentielles", notes: "Notes privées de l’orateur" };
    const latest = await seedDeck(id, null, "FINAL", spec);
    const trashed = await seedDeck(id, null, "FINAL");
    const skeleton = await seedDeck(id, themeId!, "SKELETON");
    await db().deck.update({ where: { id: older }, data: { updatedAt: new Date("2026-01-01") } });
    await db().deck.update({ where: { id: latest }, data: { updatedAt: new Date("2026-02-01") } });
    await db().deck.update({ where: { id: trashed }, data: { deletedAt: new Date(), updatedAt: new Date("2026-03-01") } });
    await db().deck.update({ where: { id: skeleton }, data: { updatedAt: new Date("2026-04-01") } });

    const [project] = await listPrograms(user.id);
    expect(project!.preview.slide).toEqual({ layout: spec.slides[0]!.layout, title: "La couverture modifiée", subtitle: "Les idées essentielles", bullets: spec.slides[0]!.bullets });
    expect(project!.preview.slide).not.toHaveProperty("notes");
    expect(project!.preview.slide).not.toHaveProperty("sectionId");
    expect(project!.preview.brand).toMatchObject({ colors: makeBrand().colors, fonts: makeBrand().fonts });
  });

  it("devrait reprendre le titre et la charte d’un projet sans diaporama, dans son format", async () => {
    const user = await createUser();
    const id = await seedProgram(user.id, "Mon premier oral");
    await db().$executeRaw`UPDATE "Program" SET "template" = jsonb_set("template", '{format}', '"4:3"'), "description" = 'Une présentation à préparer' WHERE "id" = ${id}`;
    const [project] = await listPrograms(user.id);
    expect(project!.preview).toMatchObject({ format: "4:3", slide: { layout: "title", title: "Mon premier oral", subtitle: "Une présentation à préparer", bullets: [] } });
    expect(project!.progress.nextStep).toBe("day");
  });

  it("devrait limiter les aperçus aux projets possédés, hors corbeille et anciens accès membres", async () => {
    const [owner, viewer] = [await createUser("owner"), await createUser("viewer")];
    const shared = await seedProgram(owner.id, "Projet partagé");
    await seedMember(shared, viewer.id, "VIEWER");
    await seedDeck(shared, null, "FINAL");
    await seedProgram(owner.id, "Projet privé");
    const own = await seedProgram(viewer.id, "Mon projet");
    await seedDeck(own, null, "FINAL");
    const gone = await seedProgram(viewer.id, "Projet supprimé");
    await db().program.update({ where: { id: gone }, data: { deletedAt: new Date() } });
    const list = await listPrograms(viewer.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: own, role: "owner", ownerName: null });
    expect(list[0]!.preview.slide.title).toBe(makeConformingDeck().slides[0]!.title);
  });

  it("devrait garder la galerie disponible si la charte, le format ou la couverture sont invalides", async () => {
    const user = await createUser();
    const id = await seedProgram(user.id, "Un projet récupérable");
    const deck = await seedDeck(id, null, "FINAL");
    await db().$executeRaw`UPDATE "Program" SET "brand" = '{}'::jsonb, "template" = '{"format": "carré"}'::jsonb WHERE "id" = ${id}`;
    await db().$executeRaw`UPDATE "Deck" SET "spec" = '{"slides": [42]}'::jsonb WHERE "id" = ${deck}`;
    const log = recordingLogger();
    const [project] = await listPrograms(user.id, db(), log);
    expect(project!.preview).toMatchObject({ brand: { colors: defaultBrand().colors }, format: "16:9", slide: { title: "Un projet récupérable" } });
    expect(log.events.map((event) => event.event)).toEqual(["program.list.invalid_brand", "program.list.invalid_preview"]);
  });
});
