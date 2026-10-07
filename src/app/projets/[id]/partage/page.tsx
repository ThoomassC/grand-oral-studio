import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareManager } from "@/components/projects/ShareManager";
import { NotFoundError } from "@/server/errors";
import { listMembers } from "@/server/repo/members";
import { requireUser } from "@/server/session";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Partage — ${program.name}` };
}

/**
 * Partage du projet : liste des membres pour tout membre ; invitation, changement
 * de rôle et retrait pour le propriétaire ; « Quitter ce projet » pour un membre.
 * Le dépôt filtre par rôle (lecteur et plus) : un inconnu reçoit un 404.
 */
export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const program = await loadProgram(id);
  let view: Awaited<ReturnType<typeof listMembers>>;
  try {
    view = await listMembers(user.id, program.id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-2xl">Partage</h2>
        <p className="max-w-3xl text-sm text-muted">
          {view.myRole === "owner"
            ? "Travaillez à plusieurs sur ce projet : un éditeur le modifie avec vous, un lecteur le consulte et répète ses diaporamas."
            : `Ce projet appartient à ${view.owner.name}, qui gère ses membres.`}
        </p>
      </div>
      <ShareManager
        programId={program.id}
        programName={program.name}
        currentUserId={user.id}
        myRole={view.myRole}
        owner={view.owner}
        members={view.members}
      />
    </div>
  );
}
