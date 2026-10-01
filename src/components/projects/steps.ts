import type { PrepareItemId, StepId } from "@/domain/progress";

/** Les 3 étapes du parcours d'un projet. Préparer couvre trois pages (Thèmes, Charte, Gabarit). */
export const STEPS: readonly { id: StepId; index: 1 | 2 | 3; label: string; segment: string }[] = [
  { id: "prepare", index: 1, label: "Préparer", segment: "" },
  { id: "skeletons", index: 2, label: "Squelettes", segment: "squelettes" },
  { id: "day", index: 3, label: "Jour J", segment: "jour-j" },
];

/** Les choix de l'étape Préparer : seuls les thèmes sont obligatoires. */
export const PREPARE_ITEMS: readonly { id: PrepareItemId; label: string; segment: string }[] = [
  { id: "themes", label: "Thèmes", segment: "" },
  { id: "brand", label: "Charte", segment: "charte" },
  { id: "template", label: "Gabarit", segment: "gabarit" },
];

/** Les pages du parcours dans l'ordre de lecture (barre précédent / suivant). */
export type PageId = PrepareItemId | Exclude<StepId, "prepare">;
export const PAGE_ORDER: readonly { id: PageId; label: string; segment: string }[] = [
  ...PREPARE_ITEMS,
  { id: "skeletons", label: "Squelettes", segment: "squelettes" },
  { id: "day", label: "Jour J", segment: "jour-j" },
];

export function stepMeta(id: StepId) {
  return STEPS.find((s) => s.id === id)!;
}

export function prepareItemMeta(id: PrepareItemId) {
  return PREPARE_ITEMS.find((s) => s.id === id)!;
}

export function projectBase(programId: string): string {
  return `/projets/${programId}`;
}

function hrefOfSegment(programId: string, segment: string): string {
  return segment ? `${projectBase(programId)}/${segment}` : projectBase(programId);
}

/** La page d'une étape (Préparer : la page des thèmes). */
export function stepHref(programId: string, id: StepId): string {
  return hrefOfSegment(programId, stepMeta(id).segment);
}

export function pageHref(programId: string, id: PageId): string {
  return hrefOfSegment(programId, PAGE_ORDER.find((p) => p.id === id)!.segment);
}

export function decksHref(programId: string): string {
  return `${projectBase(programId)}/decks`;
}

function under(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Le choix de Préparer affiché, ou null. */
export function prepareItemOfPath(programId: string, pathname: string): PrepareItemId | null {
  for (const item of PREPARE_ITEMS) {
    const href = hrefOfSegment(programId, item.segment);
    if (item.segment === "" ? pathname === href : under(pathname, href)) return item.id;
  }
  return null;
}

/** L'étape d'une page, sous-pages comprises (un squelette ouvert reste dans Squelettes). */
export function stepOfPath(programId: string, pathname: string): StepId | null {
  if (prepareItemOfPath(programId, pathname)) return "prepare";
  for (const s of STEPS) {
    if (s.segment && under(pathname, hrefOfSegment(programId, s.segment))) return s.id;
  }
  return null;
}

/** La page du parcours affichée exactement (pas une sous-page). */
export function exactPageOfPath(programId: string, pathname: string): PageId | null {
  return PAGE_ORDER.find((p) => hrefOfSegment(programId, p.segment) === pathname)?.id ?? null;
}

/** Ce qu'il faut faire d'abord quand l'étape `blockedBy` n'est pas faite. */
export function blockedMessage(blockedBy: StepId): string {
  switch (blockedBy) {
    case "prepare":
      return "Ajoutez d'abord des thèmes";
    case "skeletons":
      return "Générez d'abord les squelettes";
    case "day":
      return "Passez d'abord le Jour J";
  }
}
