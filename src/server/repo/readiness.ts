import { db } from "../db/client";
import { liveDeck, programAccess } from "./access";

/**
 * Lectures de la liste « Avant l'examen » d'un projet (lecteur et plus). Un
 * projet invisible (absent, étranger, à la corbeille) donne des compteurs nuls :
 * la page a déjà répondu 404 en lisant le projet.
 */

/** Diaporamas d'entraînement actifs du projet (tous auteurs confondus). */
export function countPracticeDecks(userId: string, programId: string): Promise<number> {
  return db().deck.count({
    where: { programId, kind: "FINAL", practice: true, ...liveDeck, program: programAccess(userId, "viewer") },
  });
}

/** Répétitions de `userId` sur les diaporamas actifs du projet (chacun ne compte que les siennes). */
export function countRehearsals(userId: string, programId: string): Promise<number> {
  return db().rehearsal.count({
    where: { userId, deck: { programId, ...liveDeck, program: programAccess(userId, "viewer") } },
  });
}

/** Un export PPTX a déjà été tenté sur ce projet. */
export async function exportTried(userId: string, programId: string): Promise<boolean> {
  const row = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "viewer") },
    select: { exportTriedAt: true },
  });
  return row?.exportTriedAt != null;
}

export interface ExamReadinessCounts {
  practiceDecks: number;
  rehearsals: number;
  exportTried: boolean;
}

/** Les trois lectures, en parallèle. */
export async function getExamReadiness(userId: string, programId: string): Promise<ExamReadinessCounts> {
  const [practiceDecks, rehearsals, tried] = await Promise.all([
    countPracticeDecks(userId, programId),
    countRehearsals(userId, programId),
    exportTried(userId, programId),
  ]);
  return { practiceDecks, rehearsals, exportTried: tried };
}

/**
 * Note qu'un export a été tenté sur le projet (liste « Avant l'examen »). SQL
 * brut : `Program.updatedAt` (@updatedAt, posé par le client Prisma) ne bouge
 * pas, si bien qu'un export ne rend pas périmés les diaporamas récents
 * (findRecentFinalDeck) ni la version des éditeurs. Écrit une seule fois.
 * L'appelant a déjà vérifié l'accès (lecture du deck) ; la condition
 * `deletedAt IS NULL` évite de toucher un projet à la corbeille.
 */
export async function markExportTried(programId: string): Promise<void> {
  await db().$executeRaw`
    UPDATE "Program" SET "exportTriedAt" = now()
    WHERE "id" = ${programId} AND "exportTriedAt" IS NULL AND "deletedAt" IS NULL`;
}
