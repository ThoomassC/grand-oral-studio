import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JuryQuestions, type JuryQuestionItem } from "@/components/decks/JuryQuestions";
import { decksHref } from "@/components/projects/steps";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { NotFoundError } from "@/server/errors";
import { getQuestions } from "@/server/repo/questions";
import { requireUser } from "@/server/session";
import { loadDeck, loadProgram } from "../../../../_lib/load";

/** La préparation des questions pourra passer par l'IA (génération longue) : même plafond que le jour J. */
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; deckId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  return { title: `Questions du jury — ${deck.spec.title}` };
}

/** Questions de l'utilisateur ; un diaporama invisible devient un 404 (comme loadDeck). */
async function loadQuestions(userId: string, deckId: string): Promise<JuryQuestionItem[]> {
  try {
    return await getQuestions(userId, deckId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * Questions probables du jury d'un diaporama : préparées par un éditeur,
 * révisées par chacun (lecteur compris) avec son propre statut.
 */
export default async function JuryQuestionsPage({ params }: Params) {
  const [{ id, deckId }, user] = await Promise.all([params, requireUser()]);
  // Lectures indépendantes en parallèle (dédoublonnées avec le layout et le fil d'Ariane).
  const [deck, program, questions] = await Promise.all([
    loadDeck(id, deckId),
    loadProgram(id),
    loadQuestions(user.id, deckId),
  ]);
  const deckHref = `${decksHref(id)}/${deck.id}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl">Questions du jury</h2>
          <p className="max-w-3xl text-muted">
            {deck.spec.title} · Entraînez-vous à répondre sans lire, puis révélez les éléments de réponse.
          </p>
        </div>
        <ButtonLink href={deckHref} variant="ghost">
          Retour au diaporama
        </ButtonLink>
      </div>
      <JuryQuestions deckId={deck.id} canEdit={program.role !== "viewer"} initialQuestions={questions} />
    </div>
  );
}
