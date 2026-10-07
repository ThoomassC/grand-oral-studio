import { z } from "zod";
import { DeckSpecSchema } from "@/domain/schemas";
import { rehearsalInputSchema, type RehearsalInput } from "@/domain/rehearsal";
import { db } from "../db/client";
import { parseInput, parseStored } from "../validation";
import { liveDeck, lockDeckFor, programAccess } from "./access";

/**
 * Répétitions chronométrées d'un diaporama. Ouvertes au LECTEUR (répéter n'écrit
 * rien dans le projet) ; chacun ne voit et ne compte que les siennes. Un diaporama
 * à la corbeille, ou d'un projet à la corbeille, est invisible (404).
 */

export interface RehearsalView {
  id: string;
  totalSeconds: number;
  /** Secondes passées sur chaque diapo, dans l'ordre du diaporama. */
  perSlide: number[];
  /** ISO. */
  createdAt: string;
}

/** Nombre de répétitions listées par défaut sur la page de répétition. */
export const RECENT_REHEARSALS = 5;
const MAX_LISTED = 50;

const StoredPerSlideSchema = z.array(z.number().int().min(0));

function toView(row: { id: string; totalSeconds: number; perSlide: unknown; createdAt: Date }): RehearsalView {
  return {
    id: row.id,
    totalSeconds: row.totalSeconds,
    perSlide: parseStored(StoredPerSlideSchema, row.perSlide, "Rehearsal.perSlide", row.id),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Enregistre une répétition de `userId` (lecteur et plus). Le deck est verrouillé
 * le temps de vérifier que la saisie compte un temps par diapo de sa version
 * actuelle : une diapo ajoutée entre-temps par un éditeur fait refuser la saisie
 * (ValidationError) au lieu d'enregistrer un minutage décalé.
 */
export async function saveRehearsal(
  userId: string,
  deckId: string,
  input: RehearsalInput,
): Promise<{ programId: string; rehearsal: RehearsalView }> {
  return db().$transaction(async (tx) => {
    const { programId } = await lockDeckFor(tx, userId, deckId, "viewer");
    const row = await tx.deck.findUniqueOrThrow({ where: { id: deckId }, select: { spec: true } });
    const spec = parseStored(DeckSpecSchema, row.spec, "Deck.spec", deckId);
    const value = parseInput(rehearsalInputSchema(spec.slides.length), input);
    const created = await tx.rehearsal.create({
      data: { deckId, userId, totalSeconds: value.totalSeconds, perSlide: value.perSlide },
      select: { id: true, totalSeconds: true, perSlide: true, createdAt: true },
    });
    return { programId, rehearsal: toView(created) };
  });
}

/**
 * Dernières répétitions de `userId` sur ce diaporama, de la plus récente à la plus
 * ancienne. L'accès (lecteur) est dans le WHERE : un diaporama invisible donne une
 * liste vide (la page a déjà répondu 404 en lisant le diaporama).
 */
export async function listRehearsals(userId: string, deckId: string, limit = RECENT_REHEARSALS): Promise<RehearsalView[]> {
  const rows = await db().rehearsal.findMany({
    where: { deckId, userId, deck: { ...liveDeck, program: programAccess(userId, "viewer") } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(1, limit), MAX_LISTED),
    select: { id: true, totalSeconds: true, perSlide: true, createdAt: true },
  });
  return rows.map(toView);
}

/**
 * Nombre de répétitions de `userId` par projet (progression « prêt pour le jour J »),
 * sur les diaporamas actifs des projets actifs qu'il voit encore. Un projet sans
 * répétition est absent de la table.
 */
export async function countRehearsalsByProgram(userId: string, programIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (programIds.length === 0) return counts;
  const rows = await db().$queryRaw<{ programId: string; count: number }[]>`
    SELECT d."programId", count(*)::int AS "count"
    FROM "Rehearsal" r
    JOIN "Deck" d ON d."id" = r."deckId"
    JOIN "Program" p ON p."id" = d."programId"
    WHERE r."userId" = ${userId}
      AND d."programId" = ANY(${[...programIds]}::text[])
      AND d."deletedAt" IS NULL
      AND p."deletedAt" IS NULL
      AND (
        p."ownerId" = ${userId}
        OR EXISTS (SELECT 1 FROM "ProgramMember" m WHERE m."programId" = p."id" AND m."userId" = ${userId} AND m."role" IN ('EDITOR', 'VIEWER'))
      )
    GROUP BY d."programId"`;
  for (const row of rows) counts.set(row.programId, row.count);
  return counts;
}
