import { projectHomeHref } from "./steps";

export type Crumb = { id: string; label: string; href?: string };

/** Fil d'Ariane d'un projet : « Projets / {projet} » puis l'élément final donné. Le projet mène à son apparence. */
export function projectCrumbs(programId: string, programName: string, leaf: Crumb[]): Crumb[] {
  return [
    { id: "projets", href: "/projets", label: "Projets" },
    { id: "projet", href: projectHomeHref(programId), label: programName },
    ...leaf,
  ];
}
