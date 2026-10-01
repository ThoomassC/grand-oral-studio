import { ButtonLink } from "@/components/ui/ButtonLink";
import type { Metadata } from "next";
import Link from "next/link";
import { CreateProgramForm } from "@/components/programs/CreateProgramForm";
import { ProgramActions } from "@/components/programs/ProgramActions";
import { formatDate, plural } from "@/components/ui/format";
import { listPrograms } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Projets" };

export default async function ProgramsPage() {
  const user = await requireUser();
  const programs = await listPrograms(user.id);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="eyebrow">Espace de préparation</p>
      <h1 className="mt-2 text-3xl sm:text-4xl">Projets</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Un projet regroupe les thèmes d&apos;une formation, sa charte graphique et son gabarit de présentation.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="liste-programmes">
          <h2 id="liste-programmes" tabIndex={-1} className="sr-only">
            Liste des projets
          </h2>
          {programs.length === 0 ? (
            <div className="opale-card opale-card--e0 border-dashed border-border-strong flex flex-col items-start gap-2 p-6">
              <p className="font-display text-lg font-bold">Aucun projet pour l&apos;instant</p>
              <p className="text-muted">Créez votre premier projet avec le formulaire, puis ajoutez ses thèmes.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {programs.map((p, i) => {
                const neighbour = programs[i + 1] ?? programs[i - 1];
                return (
                  <li key={p.id} className="opale-card opale-card--e1 flex flex-col gap-4 p-5 pt-7 sm:flex-row sm:items-start sm:justify-between sm:p-6 sm:pt-8">
                    <div className="min-w-0">
                      <h3 className="text-xl">
                        <Link
                          id={`programme-${p.id}`}
                          href={`/projets/${p.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {p.name}
                        </Link>
                      </h3>
                      {p.description ? <p className="mt-1 line-clamp-2 text-muted">{p.description}</p> : null}
                      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        <div className="flex gap-1">
                          <dt className="text-muted">Thèmes :</dt>
                          <dd className="num font-bold">{p.themeCount}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className="text-muted">Squelettes générés :</dt>
                          <dd className="num font-bold">
                            {p.skeletonCount}/{p.themeCount}
                          </dd>
                        </div>
                        <div className="flex gap-1">
                          <dt className="text-muted">Modifié le</dt>
                          <dd>{formatDate(p.updatedAt)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <ButtonLink href={`/projets/${p.id}/jour-j`} variant="ghost" size="small">
                        Commencer le Jour J<span className="sr-only"> pour {p.name}</span>
                      </ButtonLink>
                      <ProgramActions
                        programId={p.id}
                        programName={p.name}
                        focusAfterDelete={[neighbour ? `programme-${neighbour.id}` : null, "liste-programmes"].filter(
                          (x): x is string => x !== null,
                        )}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {programs.length > 0 ? (
            <p className="num mt-3 text-sm text-muted">{plural(programs.length, "projet")}</p>
          ) : null}
        </section>

        <section aria-labelledby="nouveau-programme" className="opale-card opale-card--e1 block h-fit p-5 sm:p-6 lg:sticky lg:top-6">
          <h2 id="nouveau-programme" className="text-xl">
            Nouveau projet
          </h2>
          <p className="mt-1 text-sm text-muted">
            Une charte neutre et un gabarit par défaut sont créés ; vous les ajusterez ensuite.
          </p>
          <div className="mt-4">
            <CreateProgramForm autoFocus={programs.length === 0} />
          </div>
        </section>
      </div>
    </div>
  );
}
