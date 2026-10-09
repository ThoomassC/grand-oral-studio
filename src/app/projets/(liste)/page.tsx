import { Badge } from "@thomascaron/opale-ui";
import type { Metadata } from "next";
import Link from "next/link";
import { CreateProgramDialog } from "@/components/programs/CreateProgramDialog";
import { BrandMark } from "@/components/layout/BrandMark";
import { PageHeading } from "@/components/layout/PageHeading";
import { ProgramActions } from "@/components/programs/ProgramActions";
import { ProjectListActions } from "@/components/programs/ProjectListActions";
import { ProjectProgressSummary } from "@/components/projects/ProjectProgressSummary";
import { projectHomeHref } from "@/components/projects/steps";
import { formatDate, plural } from "@/components/ui/format";
import { engineLabel } from "@/domain/ai-providers";
import { getWriter, listPrograms } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Projets" };

export default async function ProgramsPage() {
  const user = await requireUser();
  // Lectures indépendantes en parallèle ; le rédacteur (celui de l'utilisateur) est lu une fois pour toute la liste.
  const [programs, writer] = await Promise.all([listPrograms(user.id), getWriter(user.id)]);
  const writerLabel = engineLabel(writer.engine);

  return (
    <div className="studio-container">
      <PageHeading title="Projets" kicker="Votre studio" actions={
        <>
          {/* Dans l'état vide, l'import et l'exemple sont proposés dans l'encart, une seule fois. */}
          {programs.length > 0 ? <ProjectListActions /> : null}
          <CreateProgramDialog />
        </>
      }>
        Un projet réunit l&apos;apparence de vos diaporamas, leur trame et, si besoin, les sujets possibles de l&apos;oral.
      </PageHeading>

      <section aria-labelledby="liste-programmes" className="mt-8">
        <h2 id="liste-programmes" tabIndex={-1} className="sr-only">
          Liste des projets
        </h2>
        {programs.length === 0 ? (
          <div className="studio-empty">
            <div className="studio-empty__artwork" aria-hidden="true"><BrandMark /></div>
            <div>
              <h2 className="text-2xl">Aucun projet pour l&apos;instant</h2>
              <p className="mt-3 max-w-2xl text-muted">
                Créez votre premier projet, puis choisissez son apparence et sa trame. Vous pouvez aussi importer un
                projet exporté (.json) ou partir d&apos;un projet d&apos;exemple.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <CreateProgramDialog label="Créer mon premier projet" variant="secondary" />
                <ProjectListActions />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Le nombre de projets, en haut à droite de la liste. */}
            <p className="num mb-3 text-right text-sm text-muted">{plural(programs.length, "projet")}</p>
            <ul className="studio-project-grid">
              {programs.map((p, i) => {
                const neighbour = programs[i + 1] ?? programs[i - 1];
                return (
                  <li
                    key={p.id}
                    className="studio-project-card"
                  >
                    <div className="studio-project-card__top">
                      <span className="studio-project-card__index" aria-hidden="true"><BrandMark />{String(i + 1).padStart(2, "0")}</span>
                      <ProgramActions
                        programId={p.id}
                        programName={p.name}
                        programDescription={p.description}
                        role={p.role}
                        focusAfterDelete={[neighbour ? `programme-${neighbour.id}` : null, "liste-programmes"].filter(
                          (x): x is string => x !== null,
                        )}
                      />
                    </div>
                    <div className="studio-project-card__body">
                      <h3 className="studio-project-card__title">
                        <Link
                          id={`programme-${p.id}`}
                          href={projectHomeHref(p.id)}
                          className="underline-offset-4 hover:underline"
                        >
                          {p.name}
                        </Link>
                      </h3>
                      {/* Projet dont l'utilisateur est membre (éditeur ou lecteur), pas propriétaire. */}
                      {p.ownerName !== null ? (
                        <Badge tone="neutral" className="mt-1">
                          Partagé par {p.ownerName}
                        </Badge>
                      ) : null}
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
                    <div className="studio-project-card__footer">
                      <ProjectProgressSummary
                        programId={p.id}
                        programName={p.name}
                        progress={p.progress}
                        role={p.role}
                        writerLabel={writerLabel}
                      />
                    </div>
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
