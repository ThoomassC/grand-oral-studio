import { DeckCrumbs } from "../../../crumbs";

/**
 * Fil d'Ariane des sous-pages d'un deck (répétition, questions du jury, notes) :
 * « … / Decks / {titre du deck} / {page} ». Sans cette route, l'attrape-tout du
 * slot ne connaîtrait pas le deck ouvert.
 */
export default async function Crumbs({ params }: { params: Promise<{ id: string; deckId: string }> }) {
  const { id, deckId } = await params;
  return <DeckCrumbs programId={id} deckId={deckId} />;
}
