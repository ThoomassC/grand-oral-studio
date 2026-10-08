import type { Metadata } from "next";
import { loadDeck } from "../../../_lib/load";
import { DeckPageContent } from "./DeckPageContent";

/** « Régénérer avec l'IA » (une diapo) passe par l'IA : même plafond que le jour J. */
export const maxDuration = 300;

export async function generateMetadata({ params }: PageProps<"/projets/[id]/decks/[deckId]">): Promise<Metadata> {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  return { title: deck.spec.title };
}

export default async function DeckPage({ params, searchParams }: PageProps<"/projets/[id]/decks/[deckId]">) {
  const [{ id, deckId }, query] = await Promise.all([params, searchParams]);
  return (
    <DeckPageContent programId={id} deckId={deckId} isNewParam={query.nouveau === "1"} isCopyParam={query.copie === "1"} />
  );
}
