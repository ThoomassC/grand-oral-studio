import type { Metadata } from "next";
import { loadDeck } from "../../../_lib/load";
import { DeckPageContent } from "../../decks/[deckId]/DeckPageContent";

/** Relecture d'un squelette : même écran que les decks, sous l'onglet Squelettes. */
export async function generateMetadata({ params }: PageProps<"/projets/[id]/squelettes/[deckId]">): Promise<Metadata> {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  return { title: deck.spec.title };
}

export default async function SkeletonDeckPage({ params }: PageProps<"/projets/[id]/squelettes/[deckId]">) {
  const { id, deckId } = await params;
  return <DeckPageContent programId={id} deckId={deckId} isNewParam={false} />;
}
