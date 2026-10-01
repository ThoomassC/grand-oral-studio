import type { Metadata } from "next";
import { loadDeck } from "../../../_lib/load";
import { DeckPageContent } from "./DeckPageContent";

export async function generateMetadata({ params }: PageProps<"/programmes/[id]/decks/[deckId]">): Promise<Metadata> {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  return { title: deck.spec.title };
}

export default async function DeckPage({ params, searchParams }: PageProps<"/programmes/[id]/decks/[deckId]">) {
  const [{ id, deckId }, query] = await Promise.all([params, searchParams]);
  return <DeckPageContent programId={id} deckId={deckId} isNewParam={query.nouveau === "1"} />;
}
