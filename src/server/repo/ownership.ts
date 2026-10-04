import { NotFoundError } from "../errors";
import { Prisma } from "../db/generated/prisma/client";
import type { Tx } from "../db/client";

/**
 * Primitives d'autorisation sur la ressource. Règle unique : un programme
 * appartient à `ownerId` ; un thème ou un deck appartient au programme. Toute
 * requête filtre par le propriétaire DANS la clause WHERE — jamais un `if`
 * après coup.
 */

/** Filtre Prisma « programme appartenant à userId ». */
export const ownedProgram = (userId: string) => ({ ownerId: userId }) satisfies Prisma.ProgramWhereInput;

/**
 * Verrouille la ligne du programme (SELECT … FOR UPDATE) si et seulement si elle
 * appartient à `userId`. Sérialise les écritures concurrentes sur les thèmes
 * d'un même programme (positions, plafonds). Lève NotFoundError sinon.
 */
export async function lockOwnedProgram(tx: Tx, userId: string, programId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Program"
    WHERE "id" = ${programId} AND "ownerId" = ${userId}
    FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError("programme");
}

/**
 * Verrouille un deck (et seulement lui) s'il appartient à un programme de
 * `userId`. Renvoie son programId.
 */
export async function lockOwnedDeck(tx: Tx, userId: string, deckId: string): Promise<{ programId: string }> {
  const rows = await tx.$queryRaw<{ programId: string }[]>`
    SELECT d."programId" FROM "Deck" d
    JOIN "Program" p ON p."id" = d."programId"
    WHERE d."id" = ${deckId} AND p."ownerId" = ${userId}
    FOR UPDATE OF d`;
  const row = rows[0];
  if (!row) throw new NotFoundError("deck");
  return row;
}

/** Codes d'erreur Prisma utiles. */
export function prismaErrorCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

/** P2025 : enregistrement ciblé introuvable (where non satisfait, donc non possédé). */
export async function orNotFound<T>(
  promise: Promise<T>,
  resource: ConstructorParameters<typeof NotFoundError>[0],
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") throw new NotFoundError(resource);
    throw error;
  }
}
