import { ButtonLink } from "@/components/ui/ButtonLink";
import type { Metadata } from "next";
import Link from "next/link";
import { DeleteDeckButton } from "@/components/decks/DeckActions";
import { EngineBadge } from "@/components/decks/EngineBadge";
import { decksHref, stepHref } from "@/components/projects/steps";
import { formatDateTime } from "@/components/ui/format";
import { listFinalDecks } from "@/server/queries";
import { requireUser } from "@/server/session";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/projets/[id]/decks">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Decks — ${program.name}` };
}

/** Un ancien squelette (version 1.0), tel qu'affiché dans la liste : rien d'autre ne traverse. */
interface LegacySkeleton {
  id: string;
  title: string;
  subjectName: string;
  createdAt: Date;
}

export default async function DecksPage({ params }: PageProps<"/projets/[id]/decks">) {
  const { id } = await params;
  // Lectures indépendantes en parallèle (le projet vérifie aussi la propriété → 404).
  const [user, program] = await Promise.all([requireUser(), loadProgram(id)]);
  const decks = await listFinalDecks(user.id, program.id);
  const base = decksHref(program.id);
  // Un lecteur relit et exporte ; la suppression est réservée aux éditeurs.
  const canEdit = program.role !== "viewer";
  // Les squelettes ne sont plus générés : ceux d'avant la 1.1.0 restent lisibles, exportables et supprimables ici.
  const skeletons: LegacySkeleton[] = program.themes.flatMap((t) =>
    t.skeleton ? [{ id: t.skeleton.id, title: t.skeleton.spec.title, subjectName: t.name, createdAt: t.skeleton.createdAt }] : [],
  );

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="decks-title" className="flex flex-col gap-6">
        <div>
          <h2 id="decks-title" tabIndex={-1} className="text-2xl focus:outline-none">
            Decks du jour J
          </h2>
          <p className="text-sm text-muted">Les diaporamas complets générés à partir d&apos;une problématique.</p>
        </div>
        {decks.length === 0 ? (
          <div className="opale-card opale-card--e0 block border-dashed border-border-strong p-6">
            <p className="font-display text-lg font-semibold">Aucun deck pour l&apos;instant</p>
            <p className="mt-1 text-muted">
              Saisissez une problématique à l&apos;étape Jour J pour générer votre premier diaporama complet.
            </p>
            <ButtonLink href={stepHref(program.id, "day")} className="mt-4">
              Aller au Jour J
            </ButtonLink>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {decks.map((d, i) => {
              const neighbour = decks[i + 1] ?? decks[i - 1];
              return (
                <li key={d.id} className="opale-card opale-card--e1 flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <h3 className="font-semibold">
                      <Link id={`deck-${d.id}`} href={`${base}/${d.id}`} className="hover:underline">
                        {d.problem}
                      </Link>
                    </h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                      <span>
                        Sujet : <span className="text-text">{d.themeName ?? "Sans sujet"}</span> · généré le{" "}
                        {formatDateTime(d.createdAt)}
                      </span>
                      <EngineBadge engine={d.engine} />
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-start gap-2">
                    <ButtonLink href={`${base}/${d.id}`} variant="ghost" size="small">
                      Ouvrir<span className="sr-only"> le deck {d.title}</span>
                    </ButtonLink>
                    {canEdit ? (
                      <DeleteDeckButton
                        deckId={d.id}
                        label={d.title}
                        focusAfterDelete={[neighbour ? `deck-${neighbour.id}` : "", "decks-title"].filter(Boolean)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {skeletons.length > 0 ? (
        <section aria-labelledby="squelettes-titre" className="flex flex-col gap-6">
          <div>
            <h2 id="squelettes-titre" tabIndex={-1} className="text-2xl focus:outline-none">
              Squelettes (version 1.0)
            </h2>
            <p className="max-w-3xl text-sm text-muted">
              Préparés avant la version 1.1, ils ne servent plus le jour J : le diaporama part désormais de votre trame.
              Vous pouvez encore les ouvrir, les exporter ou les supprimer.
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {skeletons.map((s, i) => {
              const neighbour = skeletons[i + 1] ?? skeletons[i - 1];
              return (
                <li key={s.id} className="opale-card opale-card--e1 flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <h3 className="font-semibold">
                      <Link id={`squelette-${s.id}`} href={`${base}/${s.id}`} className="hover:underline">
                        {s.title}
                      </Link>
                    </h3>
                    <p className="mt-1 text-sm text-muted">
                      Sujet : <span className="text-text">{s.subjectName}</span> · créé le {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-start gap-2">
                    <ButtonLink href={`${base}/${s.id}`} variant="ghost" size="small">
                      Ouvrir<span className="sr-only"> le squelette {s.title}</span>
                    </ButtonLink>
                    {canEdit ? (
                      <DeleteDeckButton
                        deckId={s.id}
                        label={s.title}
                        undoable={false}
                        focusAfterDelete={[neighbour ? `squelette-${neighbour.id}` : "", "decks-title"].filter(Boolean)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
