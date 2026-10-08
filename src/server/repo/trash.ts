import { db, type Db } from "../db/client";

/**
 * Corbeille (v1.2) : projets et decks finaux supprimés « en douceur » (`deletedAt`).
 *  - restauration possible pendant UNDO_WINDOW_SECONDS côté serveur (l'interface
 *    annonce moins, pour absorber la latence) ;
 *  - purge définitive, opportuniste, de ce qui est à la corbeille depuis plus de
 *    PURGE_AFTER_SECONDS, au début de chaque suppression (lot borné).
 * Les horodatages viennent de l'horloge de la base (now()), seule référence commune
 * à l'écriture et à la comparaison.
 */

export const UNDO_WINDOW_SECONDS = 30;
export const PURGE_AFTER_SECONDS = 3600;
/** Lignes purgées au plus par table et par appel : une suppression ne paie jamais une purge massive. */
const PURGE_BATCH = 50;

/** Échéance d'annulation (ISO) d'un objet mis à la corbeille à `deletedAt`. */
export function undoDeadline(deletedAt: Date): string {
  return new Date(deletedAt.getTime() + UNDO_WINDOW_SECONDS * 1000).toISOString();
}

/**
 * Efface définitivement un lot d'éléments à la corbeille depuis plus d'une heure
 * (projets : thèmes, decks et membres partent en cascade). SKIP LOCKED : deux purges
 * simultanées ne s'attendent pas, chacune prend des lignes différentes.
 * Sans index sur `deletedAt` : parcours séquentiel des tables, acceptable tant que la
 * suppression reste une action rare (cf. rapport du lot L1).
 */
export async function purgeTrash(client: Db = db()): Promise<{ programs: number; decks: number }> {
  const programs = await client.$executeRaw`
    DELETE FROM "Program" WHERE "id" IN (
      SELECT "id" FROM "Program"
      WHERE "deletedAt" < now() - (${PURGE_AFTER_SECONDS}::int * interval '1 second')
      ORDER BY "deletedAt"
      LIMIT ${PURGE_BATCH}
      FOR UPDATE SKIP LOCKED)`;
  const decks = await client.$executeRaw`
    DELETE FROM "Deck" WHERE "id" IN (
      SELECT "id" FROM "Deck"
      WHERE "deletedAt" < now() - (${PURGE_AFTER_SECONDS}::int * interval '1 second')
      ORDER BY "deletedAt"
      LIMIT ${PURGE_BATCH}
      FOR UPDATE SKIP LOCKED)`;
  return { programs, decks };
}
