import { describe, expect, it } from "vitest";
import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import * as decks from "@/server/repo/decks";
import * as programs from "@/server/repo/programs";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

/**
 * Lectures tolérantes : une ligne dont le JSON a dérivé (migration manquante,
 * écriture hors application) ne fait plus tomber la page. Elle est ignorée ou
 * remplacée par la valeur par défaut, et journalisée.
 */

describe("listFinalDecks — une ligne invalide est ignorée", () => {
  it("devrait renvoyer les autres decks et journaliser la ligne invalide", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Énergie")]);
    const good = await seedDeck(programId, themeId!, "FINAL");
    const broken = await seedDeck(programId, null, "FINAL");
    // Spec corrompue directement en SQL : plus de titre.
    await db().$executeRaw`UPDATE "Deck" SET "spec" = '{"slides": "pas un tableau"}'::jsonb WHERE "id" = ${broken}`;

    const log = recordingLogger();
    const list = await decks.listFinalDecks(a.id, programId, log);

    expect(list.map((d) => d.id)).toEqual([good]);
    expect(list[0]).toMatchObject({
      id: good,
      themeId,
      themeName: "Énergie",
      problem: "Une problématique",
      title: makeConformingDeck().title,
      practice: false,
      engine: null,
    });
    expect(list[0]!.createdAt).toBeInstanceOf(Date);
    expect(log.events).toEqual([
      expect.objectContaining({ level: "warn", event: "deck.list.invalid_row", fields: expect.objectContaining({ deckId: broken }) }),
    ]);
  });

  it("devrait ignorer un titre vide ou qui n'est pas une chaîne", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const broken = await seedDeck(programId, null, "FINAL");
    const notText = await seedDeck(programId, null, "FINAL");
    await db().$executeRaw`UPDATE "Deck" SET "spec" = '{"title": "   "}'::jsonb WHERE "id" = ${broken}`;
    await db().$executeRaw`UPDATE "Deck" SET "spec" = '{"title": {"x": 1}}'::jsonb WHERE "id" = ${notText}`;
    await expect(decks.listFinalDecks(a.id, programId, recordingLogger())).resolves.toEqual([]);
  });

  it("devrait rester réservée aux membres (lecteur+) et ignorer les decks à la corbeille", async () => {
    const a = await createUser("a");
    const viewer = await createUser("viewer");
    const stranger = await createUser("stranger");
    const programId = await seedProgram(a.id);
    await seedMember(programId, viewer.id, "VIEWER");
    const live = await seedDeck(programId, null, "FINAL");
    const trashed = await seedDeck(programId, null, "FINAL");
    await db().deck.update({ where: { id: trashed }, data: { deletedAt: new Date() } });

    expect((await decks.listFinalDecks(viewer.id, programId)).map((d) => d.id)).toEqual([live]);
    await expect(decks.listFinalDecks(stranger.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getProgram — apparence, trame ou squelette invalide", () => {
  it("devrait remplacer une apparence invalide par la valeur par défaut et le signaler", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await db().$executeRaw`UPDATE "Program" SET "brand" = '{"name": 42}'::jsonb WHERE "id" = ${programId}`;

    const log = recordingLogger();
    const program = await programs.getProgram(a.id, programId, log);

    expect(program.brand).toEqual(defaultBrand());
    expect(program.template).toEqual(makeTemplate());
    expect(program.degraded).toEqual(["brand"]);
    expect(log.events).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "program.read.degraded",
        fields: expect.objectContaining({ programId, part: "brand" }),
      }),
    ]);
  });

  it("devrait remplacer une trame invalide par la valeur par défaut et le signaler", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    await db().$executeRaw`UPDATE "Program" SET "template" = '{"format": "carré"}'::jsonb WHERE "id" = ${programId}`;

    const program = await programs.getProgram(a.id, programId, recordingLogger());
    expect(program.template).toEqual(defaultTemplate());
    expect(program.brand).toEqual(makeBrand());
    expect(program.degraded).toEqual(["template"]);
  });

  it("devrait renvoyer degraded vide pour un projet sain", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const log = recordingLogger();
    const program = await programs.getProgram(a.id, programId, log);
    expect(program.degraded).toEqual([]);
    expect(log.events).toEqual([]);
  });

  it("devrait remplacer un squelette invalide par null sans faire tomber le projet", async () => {
    const a = await createUser("a");
    const programId = await seedProgram(a.id);
    const [themeId] = await seedThemes(programId, [themeInput("Énergie")]);
    const skeleton = await seedDeck(programId, themeId!, "SKELETON");
    await db().$executeRaw`UPDATE "Deck" SET "spec" = '{}'::jsonb WHERE "id" = ${skeleton}`;

    const log = recordingLogger();
    const program = await programs.getProgram(a.id, programId, log);
    expect(program.themes[0]).toMatchObject({ id: themeId, skeleton: null });
    expect(program.degraded).toEqual([]);
    expect(log.events).toEqual([
      expect.objectContaining({ level: "warn", event: "program.read.invalid_skeleton", fields: expect.objectContaining({ deckId: skeleton }) }),
    ]);
  });
});
