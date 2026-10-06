import type { Metadata } from "next";
import Link from "next/link";
import { CreateProgramDialog } from "@/components/programs/CreateProgramDialog";
import { ProgramActions } from "@/components/programs/ProgramActions";
import { ProjectProgressSummary } from "@/components/projects/ProjectProgressSummary";
import { projectHomeHref } from "@/components/projects/steps";
import { formatDate, plural } from "@/components/ui/format";
import { listPrograms } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Projets" };

export default async function ProgramsPage() {
  const user = await requireUser();
  const programs = await listPrograms(user.id);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-3xl sm:text-4xl">Projets</h1>
        <CreateProgramDialog />
      </div>
      <p className="mt-2 max-w-2xl text-muted">
        Un projet réunit l&apos;apparence de vos diaporamas, leur trame et, si besoin, les sujets possibles de l&apos;oral.
      </p>

      <section aria-labelledby="liste-programmes" className="mt-8">
        <h2 id="liste-programmes" tabIndex={-1} className="sr-only">
          Liste des projets
        </h2>
        {programs.length === 0 ? (
          <div className="opale-card opale-card--e0 border-dashed border-border-strong flex flex-col items-start gap-2 p-6">
            <p className="font-display text-lg font-bold">Aucun projet pour l&apos;instant</p>
            <p className="text-muted">Créez votre premier projet, puis choisissez son apparence et sa trame.</p>
            <div className="mt-2">
              <CreateProgramDialog label="Créer mon premier projet" variant="secondary" />
            </div>
          </div>
        ) : (
          <>
            {/* Le nombre de projets, en haut à droite de la liste. */}
            <p className="num mb-3 text-right text-sm text-muted">{plural(programs.length, "projet")}</p>
            <ul className="flex flex-col gap-3">
            {programs.map((p, i) => {
              const neighbour = programs[i + 1] ?? programs[i - 1];
              return (
                // Ligne : contenu (infos, puis avancement à droite dès sm) | bouton « ⋮ » toujours en fin de ligne.
                // `flex-row` : la carte Opale impose `flex-direction: column`. `flex-wrap` : l'annonce de la duplication (dans ProgramActions) passe dessous, sur toute la largeur.
                <li
                  key={p.id}
                  className="opale-card opale-card--e1 fiche flex flex-row flex-wrap items-start gap-x-2 gap-y-3 p-5 pt-7 pl-7 sm:gap-x-3 sm:p-6 sm:pt-8 sm:pl-8"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xl">
                        <Link
                          id={`programme-${p.id}`}
                          href={projectHomeHref(p.id)}
                          className="underline-offset-4 hover:underline"
                        >
                          {p.name}
                        </Link>
                      </h3>
                      {p.description ? <p className="mt-1 line-clamp-2 text-muted">{p.description}</p> : null}
                      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        <div className="flex gap-1 whitespace-nowrap">
                          <dt className="text-muted">Sujets :</dt>
                          <dd className="num font-bold">{p.themeCount}</dd>
                        </div>
                        <div className="flex gap-1 whitespace-nowrap">
                          <dt className="text-muted">Modifié le</dt>
                          <dd>{formatDate(p.updatedAt)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="shrink-0">
                      <ProjectProgressSummary programId={p.id} programName={p.name} progress={p.progress} />
                    </div>
                  </div>
                  <ProgramActions
                    programId={p.id}
                    programName={p.name}
                    focusAfterDelete={[neighbour ? `programme-${neighbour.id}` : null, "liste-programmes"].filter(
                      (x): x is string => x !== null,
                    )}
                  />
                </li>
              );
            })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
