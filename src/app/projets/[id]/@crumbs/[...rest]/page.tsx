import { ProjectCrumbs } from "../crumbs";

/**
 * Fil d'Ariane des autres pages du projet (charte, gabarit, squelettes, Jour J,
 * Decks). Attrape-tout : le slot correspond à toute URL du projet, donc une
 * navigation côté client ne garde jamais le fil d'une page précédente.
 */
export default async function Crumbs({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectCrumbs programId={id} />;
}
