import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Client Prisma 7 (driver adapter pg), singleton par process pour survivre au
 * rechargement à chaud de `next dev`.
 *
 * Timeouts côté base : une requête ne peut pas monopoliser une connexion
 * (statement_timeout) ni attendre un verrou indéfiniment (lock_timeout).
 */

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL n'est pas défini (voir .env.example).");
  }
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 15_000,
    // Session en UTC : sinon les dates envoyées par l'adaptateur et now() divergent du décalage du serveur.
    options: "-c TimeZone=UTC",
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/**
 * Accès paresseux : l'import du module ne lit pas l'environnement (utile au
 * build Next et aux tests, qui fixent DATABASE_URL avant le premier appel).
 */
export function db(): PrismaClient {
  if (!globalForPrisma.__prisma) {
    globalForPrisma.__prisma = createClient();
  }
  return globalForPrisma.__prisma;
}

/** Ferme le pool (scripts, fin de suite de tests). */
export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__prisma) {
    await globalForPrisma.__prisma.$disconnect();
    globalForPrisma.__prisma = undefined;
  }
}

export type Db = PrismaClient;
/** Client de transaction interactive. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
