import { DeckCrumbs } from "../../crumbs";

/** Fil d'Ariane d'un deck ouvert : « … / {étape ou Decks} / {titre du deck} ». */
export default async function Crumbs({ params }: { params: Promise<{ id: string; deckId: string }> }) {
  const { id, deckId } = await params;
  return <DeckCrumbs programId={id} deckId={deckId} />;
}
