import { NotFoundError } from "../errors";
import { Prisma } from "../db/generated/prisma/client";

/**
 * Utilitaires d'erreurs Prisma partagés par les dépôts. Le contrôle d'accès
 * (propriétaire, éditeur, lecteur) vit dans ./access.ts.
 */

/** Codes d'erreur Prisma utiles. */
export function prismaErrorCode(error: unknown): string | null {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
}

/** P2025 : enregistrement ciblé introuvable (where non satisfait). */
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
