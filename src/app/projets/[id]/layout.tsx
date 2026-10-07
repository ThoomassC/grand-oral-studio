import { Feedback } from "@thomascaron/opale-ui";
import { notFound } from "next/navigation";
import { Meter } from "@/components/ui/Meter";
import { ProjectSettingsMenu } from "@/components/programs/ProjectSettingsMenu";
import { ProjectSteps } from "@/components/layout/ProjectSteps";
import { StepNav } from "@/components/projects/StepNav";
import { TemplateTabs } from "@/components/projects/TemplateTabs";
import { NotFoundError } from "@/server/errors";
import { getProgramOwnerName } from "@/server/repo/members";
import { requireUser } from "@/server/session";
import { loadProgram } from "../_lib/load";

/** Nom du propriétaire, pour le bandeau d'un lecteur (projet retiré entre-temps : 404). */
async function ownerNameFor(programId: string): Promise<string> {
  const user = await requireUser();
  try {
    return await getProgramOwnerName(user.id, programId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * En-tête commun des pages d'un projet : fil d'Ariane (slot `@crumbs`, qui
 * connaît le deck ouvert), titre, avancement, fil d'étapes (Apparence, Trame,
 * Jour J) ; puis les onglets de la Trame (sous `/trame` seulement), la page et
 * la barre précédent / suivant. `/projets/<id>` n'a pas de page : il redirige
 * (307, next.config.ts) vers l'apparence.
 * La garde « modifications non enregistrées » est posée dans le layout racine.
 * Pour un lecteur, un bandeau rappelle que le projet est partagé en lecture seule
 * (le serveur refuse de toute façon ses modifications).
 */
export default async function ProgramLayout({ children, crumbs, params }: LayoutProps<"/projets/[id]">) {
  const { id } = await params;
  const program = await loadProgram(id);
  const { steps, templateTabs, doneCount, total } = program.progress;
  // Decks du jour J, avec ou sans sujet (les anciens squelettes ne sont pas comptés).
  const deckCount = program.finalDeckCount;
  const label = `${doneCount}/${total} étapes`;
  const sharedBy = program.role === "viewer" ? await ownerNameFor(program.id) : null;

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
              <ProjectSettingsMenu
                programId={program.id}
                name={program.name}
                description={program.description}
                role={program.role}
              />
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
        {sharedBy !== null ? (
          <Feedback tone="neutral" title={`Projet partagé par ${sharedBy} · lecture seule`} className="mb-5">
            Vous pouvez consulter, exporter et répéter les diaporamas, sans modifier le projet.
          </Feedback>
        ) : null}
        <TemplateTabs programId={program.id} tabs={templateTabs} />
        {children}
        <StepNav programId={program.id} />
      </div>
    </div>
  );
}
