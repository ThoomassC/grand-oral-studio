import { ProjectCrumbs } from "./crumbs";

/** Fil d'Ariane de la page d'accueil du projet (Thèmes). */
export default async function Crumbs({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectCrumbs programId={id} />;
}
