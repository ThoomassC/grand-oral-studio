import { projectBase } from "./steps";

/** Fil d'Ariane d'un projet, avec l'élément final donné (deck ouvert). */
export function projectCrumbs(
  programId: string,
  programName: string,
  leaf: { id: string; label: string; href?: string }[],
) {
  return [
    { id: "projets", href: "/projets", label: "Projets" },
    { id: "projet", href: projectBase(programId), label: programName },
    ...leaf,
  ];
}

