import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { getProfile } from "@/server/queries";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedProgram } from "./helpers";

setupTestDatabase();

const SECRETS = {
  password: "hash-scrypt-tres-secret",
  accessToken: "ya29.jeton-acces-google",
  refreshToken: "1//jeton-rafraichissement",
  idToken: "eyJ.jeton-identite.google",
  googleAccountId: "google-sub-1234567890",
};

async function linkAccounts(userId: string) {
  await db().account.create({
    data: { id: `cred-${userId}`, accountId: userId, providerId: "credential", userId, password: SECRETS.password },
  });
  await db().account.create({
    data: {
      id: `google-${userId}`,
      accountId: SECRETS.googleAccountId,
      providerId: "google",
      userId,
      accessToken: SECRETS.accessToken,
      refreshToken: SECRETS.refreshToken,
      idToken: SECRETS.idToken,
      scope: "openid email profile",
    },
  });
}

describe("getProfile", () => {
  it("devrait renvoyer le profil de l'utilisateur : nom, e-mail, connexions, date de création, nombre de projets", async () => {
    const a = await createUser("alice");
    await linkAccounts(a.id);
    await seedProgram(a.id);
    await seedProgram(a.id);

    const profile = await getProfile(a.id);

    expect(profile).not.toBeNull();
    expect(Object.keys(profile!).sort()).toEqual(["createdAt", "email", "name", "projectCount", "signInMethods"]);
    expect(profile).toMatchObject({ name: "alice", email: a.email, projectCount: 2, signInMethods: ["password", "google"] });
    expect(new Date(profile!.createdAt).toISOString()).toBe(profile!.createdAt);
  });

  it("ne devrait exposer aucun secret ni identifiant de compte OAuth", async () => {
    const a = await createUser("alice");
    await linkAccounts(a.id);

    const serialized = JSON.stringify(await getProfile(a.id));

    for (const secret of Object.values(SECRETS)) expect(serialized).not.toContain(secret);
    // Ni les identifiants des lignes de compte (l'e-mail de test contient l'id utilisateur : on vise les clés).
    expect(serialized).not.toContain(`cred-${a.id}`);
    expect(serialized).not.toContain(`google-${a.id}`);
    expect(serialized).not.toMatch(/"(id|userId|accountId|providerId)"/);
  });

  it("ne devrait compter que les projets de l'utilisateur, et rien de l'autre", async () => {
    const [a, b] = [await createUser("alice"), await createUser("bob")];
    await linkAccounts(b.id);
    await seedProgram(b.id);

    const profile = await getProfile(a.id);

    expect(profile).toMatchObject({ email: a.email, projectCount: 0, signInMethods: [] });
    expect(JSON.stringify(profile)).not.toContain(b.email);
  });

  it("devrait renvoyer null pour un utilisateur inexistant", async () => {
    expect(await getProfile("inconnu")).toBeNull();
  });
});
