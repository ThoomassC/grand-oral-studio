import type { Metadata } from "next";
import Link from "next/link";
import { DeleteDeckButton } from "@/components/decks/DeckActions";
import { DeckReview } from "@/components/decks/DeckReview";
import { formatDateTime } from "@/components/ui/format";
import { loadDeck } from "../../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/programmes/[id]/decks/[deckId]">): Promise<Metadata> {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  return { title: deck.spec.title };
}

export default async function DeckPage({ params }: PageProps<"/programmes/[id]/decks/[deckId]">) {
  const { id, deckId } = await params;
  const deck = await loadDeck(id, deckId);
  const isSkeleton = deck.kind === "SKELETON";
  const backHref = isSkeleton ? `/programmes/${id}/squelettes` : `/programmes/${id}/decks`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm">
          <Link href={backHref} className="link text-muted">
            {isSkeleton ? "Retour aux squelettes" : "Retour aux decks"}
          </Link>
        </p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-accent-strong">
              {isSkeleton ? "Squelette" : "Deck final"} · {deck.themeName}
            </p>
            <h2 className="mt-1 text-2xl font-bold">{deck.spec.title}</h2>
            {deck.spec.subtitle ? <p className="mt-1 text-muted">{deck.spec.subtitle}</p> : null}
            {deck.problem ? (
              <p className="mt-2">
                <span className="text-muted">Problématique : </span>
                {deck.problem}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-muted">Mis à jour le {formatDateTime(deck.updatedAt)}</p>
          </div>
          {!isSkeleton ? <DeleteDeckButton deckId={deck.id} label={deck.spec.title} redirectTo={backHref} /> : null}
        </div>
      </div>
      <DeckReview deckId={deck.id} initialSpec={deck.spec} brand={deck.program.brand} template={deck.program.template} />
    </div>
  );
}
