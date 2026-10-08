import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { db } from "@/server/db/client";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "@/server/errors";
import * as members from "@/server/repo/members";
import { assertProgramAccess, getProgram } from "@/server/repo/programs";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedMember, seedProgram } from "./helpers";

setupTestDatabase();

/**
 * Partage d'un projet (v1.2) : seul le propriétaire gère les membres (inviter,
 * changer le rôle, retirer) ; éditeur et lecteur voient la liste (403 s'ils tentent
 * de la gérer) ; un inconnu reçoit 404 ; un membre peut se retirer lui-même.
 * Le propriétaire n'est jamais une ligne membre : une ligne parasite est ignorée.
 */

async function setup() {
  const users = {
    owner: await createUser("owner"),
    editor: await createUser("editor"),
    viewer: await createUser("viewer"),
    stranger: await createUser("stranger"),
  };
  const programId = await seedProgram(users.owner.id, "Projet partagé");
  await seedMember(programId, users.editor.id, "EDITOR");
  await seedMember(programId, users.viewer.id, "VIEWER");
  return { users, programId };
}

const softDeleteProgram = (programId: string) =>
  db().program.update({ where: { id: programId }, data: { deletedAt: new Date() } });

describe("listMembers", () => {
  it("devrait lister le propriétaire et les membres pour chaque rôle, et refuser un inconnu (404)", async () => {
    const { users, programId } = await setup();
    for (const [who, expectedRole] of [
      ["owner", "owner"],
      ["editor", "editor"],
      ["viewer", "viewer"],
    ] as const) {
      const view = await members.listMembers(users[who].id, programId);
      expect(view.myRole).toBe(expectedRole);
      expect(view.owner).toMatchObject({ userId: users.owner.id, name: "owner" });
      expect(view.members.map((m) => [m.userId, m.role])).toEqual([
        [users.editor.id, "editor"],
        [users.viewer.id, "viewer"],
      ]);
      expect(view.members[0]).toMatchObject({ name: "editor" });
    }
    await expect(members.listMembers(users.stranger.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait réserver les adresses e-mail au propriétaire", async () => {
    const { users, programId } = await setup();
    const ownerView = await members.listMembers(users.owner.id, programId);
    expect(ownerView.owner.email).toBe(users.owner.email);
    expect(ownerView.members.map((m) => m.email)).toEqual([users.editor.email, users.viewer.email]);

    for (const who of ["editor", "viewer"] as const) {
      const view = await members.listMembers(users[who].id, programId);
      expect(view.owner.email).toBeNull();
      expect(view.members.map((m) => m.email)).toEqual([null, null]);
      // Aucune adresse, même la sienne, ne transite dans la réponse.
      const serialized = JSON.stringify(view);
      for (const user of Object.values(users)) expect(serialized).not.toContain(user.email);
    }
  });

  it("devrait ignorer une ligne membre parasite du propriétaire", async () => {
    const { users, programId } = await setup();
    await seedMember(programId, users.owner.id, "VIEWER");
    const view = await members.listMembers(users.owner.id, programId);
    expect(view.myRole).toBe("owner");
    expect(view.members.map((m) => m.userId)).not.toContain(users.owner.id);
  });

  it("devrait rendre un projet supprimé invisible pour tous (404)", async () => {
    const { users, programId } = await setup();
    await softDeleteProgram(programId);
    for (const who of ["owner", "editor", "viewer"] as const) {
      await expect(members.listMembers(users[who].id, programId)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});

describe("inviteMember", () => {
  it("devrait ajouter un compte existant par son adresse (casse ignorée) avec le rôle choisi", async () => {
    const { users, programId } = await setup();
    const colleague = await createUser("colleague");
    const result = await members.inviteMember(users.owner.id, programId, `  ${colleague.email.toUpperCase()} `, "viewer");
    expect(result.programName).toBe("Projet partagé");
    expect(result.member).toMatchObject({ userId: colleague.id, email: colleague.email, name: "colleague", role: "viewer" });

    // Le nouveau membre voit le projet, en lecture seulement.
    await expect(assertProgramAccess(colleague.id, programId, "viewer")).resolves.toBeUndefined();
    await expect(assertProgramAccess(colleague.id, programId, "editor")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("devrait refuser l'éditeur et le lecteur (403) et l'inconnu (404)", async () => {
    const { users, programId } = await setup();
    const colleague = await createUser("colleague");
    await expect(members.inviteMember(users.editor.id, programId, colleague.email, "viewer")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.inviteMember(users.viewer.id, programId, colleague.email, "viewer")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.inviteMember(users.stranger.id, programId, colleague.email, "viewer")).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().programMember.count({ where: { programId, userId: colleague.id } })).toBe(0);
  });

  it("devrait signaler un membre déjà présent comme un conflit, sans changer son rôle", async () => {
    const { users, programId } = await setup();
    await expect(members.inviteMember(users.owner.id, programId, users.viewer.email, "editor")).rejects.toBeInstanceOf(ConflictError);
    const row = await db().programMember.findUnique({ where: { programId_userId: { programId, userId: users.viewer.id } } });
    expect(row?.role).toBe("VIEWER");
  });

  it("devrait refuser que le propriétaire s'invite lui-même", async () => {
    const { users, programId } = await setup();
    await expect(members.inviteMember(users.owner.id, programId, users.owner.email, "editor")).rejects.toBeInstanceOf(ValidationError);
  });

  it("devrait refuser une adresse sans compte, avec un message qui invite à créer le compte", async () => {
    const { users, programId } = await setup();
    const error = await members.inviteMember(users.owner.id, programId, "personne@example.test", "editor").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toBe(
      "Aucun compte n'utilise cette adresse : votre collègue doit d'abord créer son compte.",
    );
    expect((error as ValidationError).fieldErrors?.email).toHaveLength(1);
  });

  describe("e-mails actifs (RESEND_API_KEY + EMAIL_FROM)", () => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "re_test_key");
      vi.stubEnv("EMAIL_FROM", "noreply@example.test");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("devrait refuser un compte dont l'adresse n'est pas confirmée, sans l'ajouter", async () => {
      const { users, programId } = await setup();
      const colleague = await createUser("colleague");
      const error = await members.inviteMember(users.owner.id, programId, colleague.email, "editor").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).userMessage).toMatch(/^Ce compte n'a pas encore confirmé son adresse e-mail\./);
      expect((error as ValidationError).fieldErrors?.email).toHaveLength(1);
      expect(await db().programMember.count({ where: { programId, userId: colleague.id } })).toBe(0);
    });

    it("devrait ajouter un compte dont l'adresse est confirmée", async () => {
      const { users, programId } = await setup();
      const colleague = await createUser("colleague");
      await db().user.update({ where: { id: colleague.id }, data: { emailVerified: true } });
      await expect(members.inviteMember(users.owner.id, programId, colleague.email, "editor")).resolves.toMatchObject({
        member: { userId: colleague.id, role: "editor" },
      });
    });
  });

  it("devrait accepter une adresse non confirmée quand les e-mails sont désactivés (aucune preuve possible)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const { users, programId } = await setup();
    const colleague = await createUser("colleague");
    await expect(members.inviteMember(users.owner.id, programId, colleague.email, "viewer")).resolves.toMatchObject({
      member: { userId: colleague.id },
    });
  });

  it("devrait refuser le 21e membre, sans compter la ligne parasite du propriétaire", async () => {
    const { users, programId } = await setup();
    await seedMember(programId, users.owner.id, "EDITOR"); // parasite : ignorée par le plafond
    for (let i = 0; i < members.MAX_MEMBERS_PER_PROGRAM - 2; i++) {
      const u = await createUser(`m${i}`);
      await seedMember(programId, u.id, "VIEWER");
    }
    expect(members.MAX_MEMBERS_PER_PROGRAM).toBe(20);
    const extra = await createUser("extra");
    await expect(members.inviteMember(users.owner.id, programId, extra.email, "viewer")).rejects.toBeInstanceOf(LimitExceededError);
    expect(await db().programMember.count({ where: { programId, userId: extra.id } })).toBe(0);
  });

  it("devrait accepter le 20e membre", async () => {
    const { users, programId } = await setup();
    for (let i = 0; i < members.MAX_MEMBERS_PER_PROGRAM - 3; i++) {
      const u = await createUser(`m${i}`);
      await seedMember(programId, u.id, "VIEWER");
    }
    const last = await createUser("last");
    await expect(members.inviteMember(users.owner.id, programId, last.email, "viewer")).resolves.toMatchObject({
      member: { userId: last.id },
    });
  });

  it("devrait refuser l'invitation sur un projet supprimé (404)", async () => {
    const { users, programId } = await setup();
    const colleague = await createUser("colleague");
    await softDeleteProgram(programId);
    await expect(members.inviteMember(users.owner.id, programId, colleague.email, "viewer")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait n'ajouter qu'une ligne quand deux invitations identiques arrivent en même temps", async () => {
    const { users, programId } = await setup();
    const colleague = await createUser("colleague");
    const results = await Promise.allSettled([
      members.inviteMember(users.owner.id, programId, colleague.email, "viewer"),
      members.inviteMember(users.owner.id, programId, colleague.email, "viewer"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toBeInstanceOf(ConflictError);
    expect(await db().programMember.count({ where: { programId, userId: colleague.id } })).toBe(1);
  });
});

describe("changeRole", () => {
  it("devrait permettre au propriétaire de promouvoir un lecteur en éditeur", async () => {
    const { users, programId } = await setup();
    await members.changeRole(users.owner.id, programId, users.viewer.id, "editor");
    await expect(assertProgramAccess(users.viewer.id, programId, "editor")).resolves.toBeUndefined();
  });

  it("devrait refuser l'éditeur et le lecteur (403) et l'inconnu (404)", async () => {
    const { users, programId } = await setup();
    await expect(members.changeRole(users.editor.id, programId, users.viewer.id, "editor")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.changeRole(users.viewer.id, programId, users.viewer.id, "editor")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.changeRole(users.stranger.id, programId, users.viewer.id, "editor")).rejects.toBeInstanceOf(NotFoundError);
    const row = await db().programMember.findUnique({ where: { programId_userId: { programId, userId: users.viewer.id } } });
    expect(row?.role).toBe("VIEWER");
  });

  it("devrait signaler une personne qui n'est plus membre, et refuser de toucher au propriétaire", async () => {
    const { users, programId } = await setup();
    await expect(members.changeRole(users.owner.id, programId, users.stranger.id, "editor")).rejects.toBeInstanceOf(ConflictError);
    await seedMember(programId, users.owner.id, "VIEWER");
    await expect(members.changeRole(users.owner.id, programId, users.owner.id, "editor")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("removeMember", () => {
  it("devrait retirer un membre, qui perd aussitôt l'accès ; un second retrait ne fait rien", async () => {
    const { users, programId } = await setup();
    await expect(members.removeMember(users.owner.id, programId, users.editor.id)).resolves.toEqual({ removed: true });
    await expect(getProgram(users.editor.id, programId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(members.removeMember(users.owner.id, programId, users.editor.id)).resolves.toEqual({ removed: false });
  });

  it("devrait refuser l'éditeur et le lecteur (403) et l'inconnu (404)", async () => {
    const { users, programId } = await setup();
    await expect(members.removeMember(users.editor.id, programId, users.viewer.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.removeMember(users.viewer.id, programId, users.editor.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(members.removeMember(users.stranger.id, programId, users.viewer.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().programMember.count({ where: { programId } })).toBe(2);
  });

  it("devrait refuser que le propriétaire se retire lui-même", async () => {
    const { users, programId } = await setup();
    await expect(members.removeMember(users.owner.id, programId, users.owner.id)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("leaveProject", () => {
  it("devrait permettre à un membre de quitter le projet", async () => {
    const { users, programId } = await setup();
    await members.leaveProject(users.viewer.id, programId);
    await expect(getProgram(users.viewer.id, programId)).rejects.toBeInstanceOf(NotFoundError);
    await members.leaveProject(users.editor.id, programId);
    expect(await db().programMember.count({ where: { programId } })).toBe(0);
  });

  it("devrait refuser le propriétaire (même avec une ligne parasite) et l'inconnu (404)", async () => {
    const { users, programId } = await setup();
    await seedMember(programId, users.owner.id, "VIEWER");
    await expect(members.leaveProject(users.owner.id, programId)).rejects.toBeInstanceOf(ValidationError);
    await expect(members.leaveProject(users.stranger.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait rendre un projet supprimé introuvable (404)", async () => {
    const { users, programId } = await setup();
    await softDeleteProgram(programId);
    await expect(members.leaveProject(users.viewer.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("countSharedOwnedPrograms", () => {
  it("devrait compter les projets actifs possédés et partagés, sans les lignes parasites", async () => {
    const { users, programId } = await setup();
    const solo = await seedProgram(users.owner.id, "Projet solo");
    await seedMember(solo, users.owner.id, "EDITOR"); // parasite : pas un partage
    const deleted = await seedProgram(users.owner.id, "Projet supprimé");
    await seedMember(deleted, users.viewer.id, "VIEWER");
    await softDeleteProgram(deleted);

    expect(await members.countSharedOwnedPrograms(users.owner.id)).toBe(1);
    // Un membre ne possède pas le projet partagé avec lui.
    expect(await members.countSharedOwnedPrograms(users.viewer.id)).toBe(0);
    void programId;
  });
});

describe("getProgram — nom du propriétaire (bandeau « Projet partagé par … »)", () => {
  it("devrait donner le nom du propriétaire à un membre, null au propriétaire, et refuser un inconnu (404)", async () => {
    const { users, programId } = await setup();
    expect((await getProgram(users.viewer.id, programId)).ownerName).toBe("owner");
    expect((await getProgram(users.editor.id, programId)).ownerName).toBe("owner");
    expect((await getProgram(users.owner.id, programId)).ownerName).toBeNull();
    await expect(getProgram(users.stranger.id, programId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
