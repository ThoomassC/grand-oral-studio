import { projectBase } from "./steps";

export type Crumb = { id: string; label: string; href?: string };

/** Fil d'Ariane d'un projet : « Projets / {projet} » puis l'élément final donné. */
export function projectCrumbs(programId: string, programName: string, leaf: Crumb[]): Crumb[] {
  return [
    { id: "projets", href: "/projets", label: "Projets" },
    { id: "projet", href: projectBase(programId), label: programName },
    ...leaf,
  ];
}
