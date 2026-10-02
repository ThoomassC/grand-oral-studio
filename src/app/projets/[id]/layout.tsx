import { Meter } from "@/components/ui/Meter";
import { ProjectSettingsMenu } from "@/components/programs/ProjectSettingsMenu";
import { ProjectSteps } from "@/components/layout/ProjectSteps";
import { PrepareNav } from "@/components/projects/PrepareNav";
import { StepBlockedNotice, StepNav } from "@/components/projects/StepNav";
import { loadProgram } from "../_lib/load";

/**
 * En-tête commun des pages d'un projet : fil d'Ariane (slot `@crumbs`, qui
 * connaît le deck ouvert), titre, avancement, fil d'étapes ; puis la page.
 * La garde « modifications non enregistrées » est posée dans le layout racine.
 */
export default async function ProgramLayout({ children, crumbs, params }: LayoutProps<"/projets/[id]">) {
  const { id } = await params;
  const program = await loadProgram(id);
  const { steps, prepare, doneCount, total } = program.progress;
  const deckCount = program.themes.reduce((n, t) => n + t.finalDeckCount, 0);
  const label = `${doneCount}/${total} étapes`;

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 pt-3 pb-3 sm:px-6 sm:pt-4">
          {crumbs}
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-start gap-1.5">
              <h1 className="line-clamp-2 min-w-0 text-2xl break-words sm:text-3xl" title={program.name}>
                {program.name}
              </h1>
              <ProjectSettingsMenu programId={program.id} name={program.name} description={program.description} />
            </div>
            <div className="w-full shrink-0 sm:w-64">
              <p className="text-sm font-semibold">
                <span className="font-normal text-muted">Préparation : </span>
                <span className="num">{label}</span>
              </p>
              <Meter className="mt-1.5" value={doneCount} max={total} label="Étapes faites" valueText={label} />
            </div>
          </div>
          <div className="mt-4">
            <ProjectSteps programId={program.id} steps={steps} deckCount={deckCount} />
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <StepBlockedNotice programId={program.id} steps={steps} />
        <PrepareNav programId={program.id} items={prepare} />
        {children}
        <StepNav programId={program.id} prepare={prepare} steps={steps} />
      </div>
    </div>
  );
}
