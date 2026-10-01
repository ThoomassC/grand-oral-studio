import { randomUUID } from "node:crypto";
import { afterAll, beforeEach } from "vitest";
import { db, disconnectDb } from "@/server/db/client";

/**
 * Outils des tests d'intégration (vraie base PostgreSQL de test).
 *
 * Garde-fou : tout appel vérifie que DATABASE_URL pointe sur une base dont le nom
 * se termine par `_test`. Le projet vitest « integration » force déjà cette URL ;
 * ce contrôle protège contre un lancement par un autre chemin.
 */

export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL absent : lancez les tests d'intégration via `npm run test:int`.");
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refus de vider la base « ${dbName} » : ce n'est pas une base de test.`);
  }
}

/** Vide toutes les tables applicatives (domaine, auth, quotas). */
export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  await db().$executeRawUnsafe(
    `TRUNCATE TABLE "Deck", "Theme", "Program", "usage_window", "user_ai_settings", "session", "account", "verification", "rateLimit", "user" RESTART IDENTITY CASCADE`,
  );
}

/**
 * À appeler en tête de chaque fichier *.int.test.ts : base vidée avant chaque
 * test, pool fermé en fin de fichier.
 */
export function setupTestDatabase(): void {
  assertTestDatabase();
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await disconnectDb();
  });
}

export interface TestUser {
  id: string;
  email: string;
}

/** Crée un utilisateur aux identifiants uniques. */
export async function createUser(label = "user"): Promise<TestUser> {
  const id = `${label}-${randomUUID()}`;
  const email = `${id}@example.test`;
  await db().user.create({ data: { id, name: label, email } });
  return { id, email };
}
