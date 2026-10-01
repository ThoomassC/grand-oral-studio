import Link from "next/link";
import { DeleteDeckButton } from "@/components/decks/DeckActions";
import { DeckReview } from "@/components/decks/DeckReview";
import { formatDateTime } from "@/components/ui/format";
import { loadDeck } from "../../../_lib/load";

const toIso = (value: Date | string): string => (typeof value === "string" ? value : value.toISOString());
const normalize = (s: string) => s.trim().toLocaleLowerCase("fr");

/** Écran de relecture d'un deck (final ou squelette), partagé par les deux routes. */
export async function DeckPageContent({
  programId: id,
  deckId,
  isNewParam,
}: {
  programId: string;
  deckId: string;
  isNewParam: boolean;
}) {
  const deck = await loadDeck(id, deckId);
  const isSkeleton = deck.kind === "SKELETON";
  const isNew = isNewParam && !isSkeleton;
  const backHref = isSkeleton ? `/programmes/${id}/squelettes` : `/programmes/${id}/decks`;
  const updatedAt = toIso(deck.updatedAt);
  const showSubtitle = deck.spec.subtitle && normalize(deck.spec.subtitle) !== normalize(deck.program.name);
  const showProblem = deck.problem && !normalize(deck.spec.title).includes(normalize(deck.problem));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm">
          <Link href={backHref} className="link text-muted">
            {isSkeleton ? "Retour aux squelettes" : "Retour aux decks"}
          </Link>
        </p>
        <p className="mt-3 text-sm font-semibold uppercase tracking-[0.08em] text-accent-strong">
          {isSkeleton ? "Squelette" : "Deck final"} · {deck.themeName}
        </p>
        <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{deck.spec.title}</h2>
        {showSubtitle ? <p className="mt-1 text-lg text-muted">{deck.spec.subtitle}</p> : null}
        {showProblem ? (
          <p className="mt-2">
            <span className="text-muted">Problématique : </span>
            {deck.problem}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-muted">Mis à jour le {formatDateTime(new Date(updatedAt))}</p>
      </div>

      {isNew ? (
        <div role="status" className="rounded-lg border border-success/40 bg-success-soft p-4">
          <p className="font-semibold">
            Votre diaporama est prêt : {deck.spec.slides.length} diapos avec notes d&apos;orateur.
          </p>
          <p className="mt-1 text-sm">Relisez-le, puis téléchargez le .pptx pour Canva.</p>
        </div>
      ) : null}

      <DeckReview
        deckId={deck.id}
        initialSpec={deck.spec}
        initialUpdatedAt={updatedAt}
        brand={deck.program.brand}
        template={deck.program.template}
      />

      {!isSkeleton ? (
        <section aria-labelledby="zone-suppression" className="border-t border-border pt-6">
          <h2 id="zone-suppression" className="text-lg font-semibold">
            Supprimer ce deck
          </h2>
          <p className="mt-1 text-sm text-muted">Le diaporama et ses notes seront définitivement effacés.</p>
          <div className="mt-3">
            <DeleteDeckButton deckId={deck.id} label={deck.spec.title} redirectTo={backHref} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
