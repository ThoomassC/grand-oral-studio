import type { Metadata } from "next";
import { BrandMark } from "@/components/layout/BrandMark";
import { PageHeading } from "@/components/layout/PageHeading";
import { ProjectStartMenu } from "@/components/programs/ProjectStartMenu";
import { ProjectGallery } from "@/components/projects/ProjectGallery";
import { ProjectGalleryCard } from "@/components/projects/ProjectGalleryCard";
import { engineLabel } from "@/domain/ai-providers";
import { getWriter, listPrograms } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Projets" };

export default async function ProgramsPage() {
  const user = await requireUser();
  const [programs, writer] = await Promise.all([listPrograms(user.id), getWriter(user.id)]);

  return (
    <div className="studio-container">
      <PageHeading title="Projets" actions={programs.length ? <ProjectStartMenu /> : null}>
        Vos présentations, en un coup d&apos;œil.
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
                Créez votre première présentation, partez d&apos;un exemple ou importez un projet existant.
                Vous pourrez ensuite choisir son apparence et préparer votre oral.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <ProjectStartMenu label="Créer mon premier projet" />
              </div>
            </div>
          </div>
        ) : (
          <ProjectGallery
            writerLabel={programs.some((p) => p.role !== "viewer") ? engineLabel(writer.engine) : null}
            items={programs.map((p, i) => {
              const neighbour = programs[i + 1] ?? programs[i - 1];
              return {
                id: p.id,
                name: p.name,
                searchText: `${p.name} ${p.description} ${p.ownerName ?? ""}`,
                updatedAt: p.updatedAt.getTime(),
                ready: p.progress.nextStep === null,
                shared: p.role !== "owner",
                card: <ProjectGalleryCard key={p.id} program={p} focusAfterDelete={[neighbour ? `programme-${neighbour.id}` : null, "liste-programmes"].filter((id): id is string => id !== null)} />,
              };
            })}
          />
        )}
      </section>
    </div>
  );
}
