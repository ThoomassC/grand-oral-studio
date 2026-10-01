import type { Metadata } from "next";
import Link from "next/link";
import { DeleteDeckButton } from "@/components/decks/DeckActions";
import { EngineBadge } from "@/components/decks/EngineBadge";
import { formatDateTime } from "@/components/ui/format";
import { listFinalDecks } from "@/server/queries";
import { requireUser } from "@/server/session";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/programmes/[id]/decks">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Decks — ${program.name}` };
}

export default async function DecksPage({ params }: PageProps<"/programmes/[id]/decks">) {
  const { id } = await params;
  // Lectures indépendantes en parallèle (le programme vérifie aussi la propriété → 404).
  const [user, program] = await Promise.all([requireUser(), loadProgram(id)]);
  const decks = await listFinalDecks(user.id, program.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 id="decks-title" tabIndex={-1} className="text-2xl focus:outline-none">
          Decks du jour J
        </h2>
        <p className="text-sm text-muted">Les diaporamas complets générés à partir d&apos;une problématique.</p>
      </div>
      {decks.length === 0 ? (
        <div className="card-empty p-6">
          <p className="font-display text-lg font-semibold">Aucun deck pour l&apos;instant</p>
          <p className="mt-1 text-muted">
            Saisissez une problématique dans l&apos;onglet Jour J pour générer votre premier deck complet.
          </p>
          <Link href={`/programmes/${program.id}/jour-j`} className="btn btn-primary mt-4">
            Aller au Jour J
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {decks.map((d, i) => {
            const neighbour = decks[i + 1] ?? decks[i - 1];
            return (
            <li key={d.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
              <div className="min-w-0">
                <h3 className="font-semibold">
                  <Link id={`deck-${d.id}`} href={`/programmes/${program.id}/decks/${d.id}`} className="hover:underline">
                    {d.problem}
                  </Link>
                </h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  <span>
                    Thème : <span className="text-text">{d.themeName}</span> · généré le {formatDateTime(d.createdAt)}
                  </span>
                  <EngineBadge engine={d.engine} />
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-start gap-2">
                <Link href={`/programmes/${program.id}/decks/${d.id}`} className="btn btn-secondary btn-sm">
                  Ouvrir<span className="sr-only"> le deck {d.title}</span>
                </Link>
                <DeleteDeckButton
                  deckId={d.id}
                  label={d.title}
                  focusAfterDelete={[neighbour ? `deck-${neighbour.id}` : "", "decks-title"].filter(Boolean)}
                />
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
