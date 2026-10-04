import { ProjectCrumbs } from "./crumbs";

/** Repli du slot au chargement complet d'une page sans correspondance. */
export default async function CrumbsDefault({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectCrumbs programId={id} />;
}
