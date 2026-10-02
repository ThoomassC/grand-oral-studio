import { ProjectBreadcrumb } from "@/components/projects/ProjectBreadcrumb";
import { loadDeck, loadProgram } from "../../_lib/load";

/**
 * Contenu du slot `@crumbs` : le fil d'Ariane du projet, posé par le layout
 * en tête de page, au même endroit sur toutes les pages. Les lectures sont
 * dédoublonnées avec celles du layout et de la page (`cache`).
 */
export async function ProjectCrumbs({ programId }: { programId: string }) {
  const program = await loadProgram(programId);
  return <ProjectBreadcrumb programId={program.id} programName={program.name} />;
}

/** Variante d'un deck ouvert (final ou squelette) : le fil finit par son titre. */
export async function DeckCrumbs({ programId, deckId }: { programId: string; deckId: string }) {
  const deck = await loadDeck(programId, deckId);
  return (
    <ProjectBreadcrumb
      programId={programId}
      programName={deck.program.name}
      deck={{ kind: deck.kind === "SKELETON" ? "skeleton" : "final", title: deck.spec.title }}
    />
  );
}
