import { notFound } from "next/navigation";
import { cache } from "react";
import { getDeck, getProgram, NotFoundError, type DeckWithProgram, type ProgramDetail } from "@/server/queries";
import { requireUser } from "@/server/session";

/**
 * Lectures partagées par le layout et les pages d'un projet. `cache`
 * dédoublonne l'appel au sein d'un même rendu (layout + page = une requête).
 * Une ressource absente ou étrangère devient un 404.
 */
export const loadProgram = cache(async (id: string): Promise<ProgramDetail> => {
  const user = await requireUser();
  try {
    return await getProgram(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

export const loadDeck = cache(async (programId: string, deckId: string): Promise<DeckWithProgram> => {
  const user = await requireUser();
  try {
    const deck = await getDeck(user.id, deckId);
    if (deck.program.id !== programId) notFound();
    return deck;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

/** Compte des squelettes générés d'un projet. */
export function skeletonCount(program: ProgramDetail): number {
  return program.themes.filter((t) => t.skeleton !== null).length;
}
