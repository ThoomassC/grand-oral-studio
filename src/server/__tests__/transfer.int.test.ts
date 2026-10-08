import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECT_NAME } from "@/domain/examples";
import { defaultBrand } from "@/domain/defaults";
import { PROJECT_EXPORT_MAX_THEMES, serializeProjectExport } from "@/domain/project-export";
import { db } from "@/server/db/client";
import { NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import { getProgram } from "@/server/repo/programs";
import { listFinalDecks } from "@/server/repo/decks";
import * as transfer from "@/server/services/project-transfer";
import { MAX_THEMES_PER_PROGRAM } from "@/server/validation";
import { makeBrand, makeConformingDeck } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

/** Logo PNG valide (BrandSchema) de ~100 Ko, pour vérifier qu'il est retiré de l'export du compte. */
const LOGO = `data:image/png;base64,${"A".repeat(100_000)}`;

/** Diaporama lourd (~54 Ko en UTF-8) : notes au maximum, en caractères accentués (2 octets). */
function heavyDeck() {
  const deck = makeConformingDeck();
  return { ...deck, slides: deck.slides.map((s) => ({ ...s, notes: "é".repeat(3000) })) };
}

async function seedHeavyDecks(programId: string, n: number): Promise<void> {
  await db().deck.createMany({
    data: Array.from({ length: n }, () => ({ programId, kind: "FINAL" as const, problem: "Une problématique", spec: heavyDeck() })),
  });
}

setupTestDatabase();

const deps = () => ({ log: recordingLogger(), now: () => new Date("2026-10-07T10:00:00.000Z") });

/** Projet de A : 2 sujets, un deck final rattaché, un deck sans sujet, un squelette et un deck à la corbeille. */
async function seedFullProject(ownerId: string): Promise<string> {
  const programId = await seedProgram(ownerId, "Projet complet");
  const [t1, t2] = await seedThemes(programId, [
    { ...themeInput("Énergie", ["climat"], "Notes énergie"), problems: ["Comment financer la transition ?"] },
    themeInput("Ville"),
  ]);
  await seedDeck(programId, t1!, "FINAL");
  await seedDeck(programId, null, "FINAL");
  await seedDeck(programId, t2!, "SKELETON");
  const trashed = await seedDeck(programId, t2!, "FINAL");
  await db().deck.update({ where: { id: trashed }, data: { deletedAt: new Date() } });
  return programId;
}

describe("exportProject", () => {
  it("devrait exporter le projet pour un lecteur, sans squelette, corbeille ni identifiant interne", async () => {
    const [owner, viewer] = [await createUser("alice"), await createUser("vic")];
    const programId = await seedFullProject(owner.id);
    await seedMember(programId, viewer.id, "VIEWER");

    const { data, title } = await transfer.exportProject(viewer.id, programId, deps());

    expect(title).toBe("Projet complet");
    expect(data.project.themes.map((t) => t.name)).toEqual(["Énergie", "Ville"]);
    expect(data.project.themes[0]!.problems).toEqual(["Comment financer la transition ?"]);
    expect(data.project.decks.map((d) => d.themeName).sort()).toEqual(["Énergie", null].sort());
    const text = serializeProjectExport(data);
    for (const forbidden of [programId, owner.id, viewer.id, "ownerId", "members", "deletedAt"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("devrait répondre 404 à un inconnu et pour un projet à la corbeille", async () => {
    const [owner, stranger] = [await createUser("alice"), await createUser("eve")];
    const programId = await seedProgram(owner.id);
    await expect(transfer.exportProject(stranger.id, programId, deps())).rejects.toBeInstanceOf(NotFoundError);
    await db().program.update({ where: { id: programId }, data: { deletedAt: new Date() } });
    await expect(transfer.exportProject(owner.id, programId, deps())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("exportProject — données abîmées et taille", () => {
  it("devrait exporter un projet à l'apparence illisible et au diaporama abîmé : défaut, diaporama écarté et compté, journalisé", async () => {
    const alice = await createUser("alice");
    const programId = await seedFullProject(alice.id);
    await db().$executeRawUnsafe(`UPDATE "Program" SET "brand" = '{"colors":"rouge"}'::jsonb WHERE "id" = $1`, programId);
    const [broken] = await db().deck.findMany({ where: { programId, kind: "FINAL", deletedAt: null }, select: { id: true }, take: 1 });
    await db().$executeRawUnsafe(`UPDATE "Deck" SET "spec" = '{"slides":"x"}'::jsonb WHERE "id" = $1`, broken!.id);
    const log = recordingLogger();

    const { data, body } = await transfer.exportProject(alice.id, programId, { ...deps(), log });

    expect(data.project.brand).toEqual(defaultBrand());
    expect(data.project.decks).toHaveLength(1);
    expect(data.project.skipped).toBe(1);
    expect(JSON.parse(body)).toEqual(data);
    expect(body).not.toContain("\n");
    const warning = log.events.find((e) => e.event === "project.export_degraded");
    expect(warning?.level).toBe("warn");
    expect(JSON.stringify(warning?.fields)).toContain(broken!.id);
    // Le fichier dégradé se réimporte.
    await expect(transfer.importProject(alice.id, body, deps())).resolves.toMatchObject({ reused: false });
  });

  it("devrait refuser (413) un projet qui dépasse 4 Mo une fois exporté, avec un message qui dit quoi faire", async () => {
    const alice = await createUser("alice");
    const programId = await seedProgram(alice.id, "Projet lourd");
    await seedHeavyDecks(programId, 80);

    const error = await transfer.exportProject(alice.id, programId, deps()).catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 413,
      userMessage:
        "Ce projet dépasse 4 Mo une fois exporté : il ne pourrait pas être réimporté. Supprimez des diaporamas anciens ou allégez le logo.",
    });
  });
});

describe("importProject", () => {
  it("devrait créer un NOUVEAU projet appartenant à l'importateur, sujets ordonnés et decks rattachés par nom", async () => {
    const [alice, bob] = [await createUser("alice"), await createUser("bob")];
    const source = await seedFullProject(alice.id);
    const { data } = await transfer.exportProject(alice.id, source, deps());

    const { id, reused } = await transfer.importProject(bob.id, serializeProjectExport(data), deps());

    expect(reused).toBe(false);
    expect(id).not.toBe(source);
    const detail = await getProgram(bob.id, id);
    expect(detail.role).toBe("owner");
    expect(detail.name).toBe("Projet complet");
    expect(detail.themes.map((t) => [t.position, t.name])).toEqual([
      [0, "Énergie"],
      [1, "Ville"],
    ]);
    expect(detail.themes[0]!.notes).toBe("Notes énergie");
    expect(detail.themes.every((t) => t.skeleton === null)).toBe(true);
    const decks = await listFinalDecks(bob.id, id);
    expect(decks.map((d) => d.themeId).sort()).toEqual([detail.themes[0]!.id, null].sort());
    // La source est intacte et Bob n'y a pas accès.
    await expect(getProgram(bob.id, source)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().program.count({ where: { ownerId: alice.id } })).toBe(1);
  });

  it("devrait renvoyer le projet déjà créé quand le même import est rejoué aussitôt", async () => {
    const alice = await createUser("alice");
    const source = await seedFullProject(alice.id);
    const text = serializeProjectExport((await transfer.exportProject(alice.id, source, deps())).data);

    const [a, b] = await Promise.all([
      transfer.importProject(alice.id, text, deps()),
      transfer.importProject(alice.id, text, deps()),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(await db().program.count({ where: { ownerId: alice.id } })).toBe(2);
  });

  it("ne devrait jamais renvoyer un projet créé à la main, même de même nom et de même taille", async () => {
    const alice = await createUser("alice");
    const manual = await seedProgram(alice.id, "Projet vide");
    const source = await seedProgram(alice.id, "Projet vide");
    // Même nom et MÊME contenu que le projet manuel (apparence, trame, aucun sujet ni diaporama).
    const text = serializeProjectExport((await transfer.exportProject(alice.id, source, deps())).data);
    await db().program.update({ where: { id: source }, data: { deletedAt: new Date() } });

    const first = await transfer.importProject(alice.id, text, deps());
    expect(first.reused).toBe(false);
    expect([manual, source]).not.toContain(first.id);
    // Le même fichier rejoué aussitôt renvoie l'import, pas le projet manuel.
    expect(await transfer.importProject(alice.id, text, deps())).toEqual({ id: first.id, reused: true });
  });

  it("ne devrait pas confondre deux fichiers de même nom et de mêmes nombres de sujets et de diaporamas", async () => {
    const alice = await createUser("alice");
    const source = await seedFullProject(alice.id);
    const before = (await transfer.exportProject(alice.id, source, deps())).data;
    const after = { ...before, project: { ...before.project, themes: before.project.themes.map((t, i) => (i === 0 ? { ...t, notes: "Notes modifiées" } : t)) } };

    const a = await transfer.importProject(alice.id, serializeProjectExport(before), deps());
    const b = await transfer.importProject(alice.id, serializeProjectExport(after), deps());

    expect(b.reused).toBe(false);
    expect(b.id).not.toBe(a.id);
  });

  it("devrait refuser un fichier invalide par une ValidationError, sans rien créer", async () => {
    const alice = await createUser("alice");
    await expect(transfer.importProject(alice.id, "{\"format\":\"autre\"}", deps())).rejects.toBeInstanceOf(ValidationError);
    await expect(transfer.importProject(alice.id, "pas du json", deps())).rejects.toBeInstanceOf(ValidationError);
    expect(await db().program.count()).toBe(0);
  });

  it("devrait appliquer le quota d'import", async () => {
    const alice = await createUser("alice");
    await db().usageWindow.create({ data: { key: `import:${alice.id}`, windowStart: new Date(), count: 60 } });
    await expect(transfer.importProject(alice.id, "{}", deps())).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("devrait aligner le plafond de sujets du format sur celui du serveur", () => {
    expect(PROJECT_EXPORT_MAX_THEMES).toBe(MAX_THEMES_PER_PROGRAM);
  });
});

describe("createExampleProject", () => {
  it("devrait créer le projet d'exemple avec ses 3 sujets, rejouable sans doublon", async () => {
    const alice = await createUser("alice");
    const first = await transfer.createExampleProject(alice.id, deps());
    const again = await transfer.createExampleProject(alice.id, deps());

    expect(again).toEqual({ id: first.id, reused: true });
    const detail = await getProgram(alice.id, first.id);
    expect(detail.name).toBe(EXAMPLE_PROJECT_NAME);
    expect(detail.themes).toHaveLength(3);
    expect(detail.themes.every((t) => t.problems.length >= 2)).toBe(true);
  });
});

describe("exportAccount", () => {
  it("devrait exporter profil, projets POSSÉDÉS et réglages IA, sans aucun secret", async () => {
    const [alice, bob] = [await createUser("alice"), await createUser("bob")];
    const own = await seedFullProject(alice.id);
    const shared = await seedProgram(bob.id, "Projet de Bob");
    await seedMember(shared, alice.id, "EDITOR");
    const trashed = await seedProgram(alice.id, "Projet supprimé");
    await db().program.update({ where: { id: trashed }, data: { deletedAt: new Date() } });

    await db().account.create({
      data: { id: "acc-1", accountId: alice.id, providerId: "credential", userId: alice.id, password: "HASH-SECRET-123" },
    });
    await db().session.create({
      data: { id: "sess-1", token: "SESSION-TOKEN-SECRET", userId: alice.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    await db().userAiSettings.create({
      data: {
        userId: alice.id,
        engine: "claude",
        keySource: "user",
        anthropicKeyCiphertext: "v1:CIPHERiv:CIPHERtag:CIPHERtext",
        anthropicKeyLast4: "L4ST",
        keyVersion: 1,
      },
    });
    await db().userAiCredential.create({
      data: {
        userId: alice.id,
        provider: "mistral",
        ciphertext: "v1:CREDiv:CREDtag:CREDtext",
        keyVersion: 1,
        aadScheme: 2,
        last4: "WXYZ",
        model: "mistral-large-latest",
      },
    });
    await db().sharedModel.create({ data: { authorId: alice.id, kind: "BRAND", name: "Ma charte", payload: makeBrand() } });

    const { data: account } = await transfer.exportAccount(alice.id, deps());

    expect(account.profile).toMatchObject({ name: "alice", email: alice.email, signInMethods: ["password"] });
    expect(account.projects.map((p) => p.name)).toEqual(["Projet complet"]);
    expect(account.aiSettings).toMatchObject({ engine: "claude", keySource: "user" });
    expect(account.aiConnections).toEqual([
      expect.objectContaining({ provider: "mistral", model: "mistral-large-latest", keySaved: true }),
    ]);
    expect(account.sharedModels.map((m) => m.name)).toEqual(["Ma charte"]);

    const text = JSON.stringify(account);
    // L'identifiant n'apparaît que dans l'e-mail de test (fabriqué à partir de lui).
    expect(text.split(alice.id)).toHaveLength(2);
    for (const secret of ["HASH-SECRET", "SESSION-TOKEN", "CIPHER", "CRED", "L4ST", "WXYZ", own, shared, "acc-1", "sess-1", "ownerId", "userId", "authorId"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("exportAccount — robustesse et taille", () => {
  it("ne devrait jamais échouer pour un projet abîmé, et retirer les logos (projets et modèles) en le disant", async () => {
    const alice = await createUser("alice");
    const sound = await seedProgram(alice.id, "Projet sain");
    await db().program.update({ where: { id: sound }, data: { brand: makeBrand({ logoDataUrl: LOGO }) } });
    const broken = await seedProgram(alice.id, "Projet abîmé");
    await db().$executeRawUnsafe(`UPDATE "Program" SET "template" = '{"sections":1}'::jsonb WHERE "id" = $1`, broken);
    await db().sharedModel.create({ data: { authorId: alice.id, kind: "BRAND", name: "Charte logo", payload: makeBrand({ logoDataUrl: LOGO }) } });

    const { data, body } = await transfer.exportAccount(alice.id, deps());

    expect(data.projects.map((p) => p.name)).toEqual(["Projet sain", "Projet abîmé"]);
    expect(data.projects[0]).toMatchObject({ brand: { logoDataUrl: null }, note: "logo non inclus" });
    expect(data.projects[1]).not.toHaveProperty("note");
    expect(data.sharedModels[0]).toMatchObject({ payload: { logoDataUrl: null }, note: "logo non inclus" });
    expect(body).not.toContain(LOGO.slice(0, 40));
    expect(body).not.toContain("\n");
    expect(JSON.parse(body)).toEqual(data);
  });

  it("devrait refuser (413) un compte qui dépasse 4,5 Mo une fois exporté, même sans les logos", async () => {
    const alice = await createUser("alice");
    for (const name of ["Projet A", "Projet B"]) {
      const programId = await seedProgram(alice.id, name);
      await seedHeavyDecks(programId, 45); // ~2,4 Mo chacun : exportables un par un
    }
    await expect(transfer.exportProject(alice.id, (await db().program.findFirstOrThrow({ where: { name: "Projet A" } })).id, deps())).resolves.toBeDefined();

    const error = await transfer.exportAccount(alice.id, deps()).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 413 });
    expect((error as { userMessage: string }).userMessage).toMatch(/4,5 Mo/);
    expect((error as { userMessage: string }).userMessage).toMatch(/un par un/);
  });
});
