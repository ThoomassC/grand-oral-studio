import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECT_NAME } from "@/domain/examples";
import { PROJECT_EXPORT_MAX_THEMES, serializeProjectExport } from "@/domain/project-export";
import { db } from "@/server/db/client";
import { NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import { getProgram } from "@/server/repo/programs";
import { listFinalDecks } from "@/server/repo/decks";
import * as transfer from "@/server/services/project-transfer";
import { MAX_THEMES_PER_PROGRAM } from "@/server/validation";
import { makeBrand } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { recordingLogger, seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

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

    const account = await transfer.exportAccount(alice.id, deps());

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
