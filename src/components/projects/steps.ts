import type { StepId, TemplateTabId } from "@/domain/progress";

/** Les 3 étapes du parcours d'un projet. La Trame couvre deux pages (Diapos, Sujets). */
export const STEPS: readonly { id: StepId; index: 1 | 2 | 3; label: string; segment: string }[] = [
  { id: "appearance", index: 1, label: "Apparence", segment: "apparence" },
  { id: "template", index: 2, label: "Trame", segment: "trame" },
  { id: "day", index: 3, label: "Jour J", segment: "jour-j" },
];

/** Les onglets de l'étape Trame : ses diapos, puis les sujets (facultatifs). */
export const TEMPLATE_TABS: readonly { id: TemplateTabId; label: string; segment: string }[] = [
  { id: "slides", label: "Diapos", segment: "trame" },
  { id: "subjects", label: "Sujets", segment: "trame/sujets" },
];

/** Les pages du parcours dans l'ordre de lecture (barre précédent / suivant). */
export type PageId = "appearance" | "template" | "subjects" | "day";
export const PAGE_ORDER: readonly { id: PageId; label: string; segment: string }[] = [
  { id: "appearance", label: "Apparence", segment: "apparence" },
  { id: "template", label: "Trame", segment: "trame" },
  { id: "subjects", label: "Sujets", segment: "trame/sujets" },
  { id: "day", label: "Jour J", segment: "jour-j" },
];

export function stepMeta(id: StepId) {
  return STEPS.find((s) => s.id === id)!;
}

/** Préfixe des adresses d'un projet. `/projets/<id>` seul redirige (307) vers l'apparence. */
export function projectBase(programId: string): string {
  return `/projets/${programId}`;
}

function hrefOf(programId: string, segment: string): string {
  return `${projectBase(programId)}/${segment}`;
}

/** La page d'une étape (Trame : l'onglet Diapos). */
export function stepHref(programId: string, id: StepId): string {
  return hrefOf(programId, stepMeta(id).segment);
}

/** Page d'arrivée d'un projet, sans passer par la redirection de `/projets/<id>`. */
export function projectHomeHref(programId: string): string {
  return stepHref(programId, "appearance");
}

export function pageHref(programId: string, id: PageId): string {
  return hrefOf(programId, PAGE_ORDER.find((p) => p.id === id)!.segment);
}

export function decksHref(programId: string): string {
  return hrefOf(programId, "decks");
}

function under(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** L'onglet de la Trame affiché : `/trame` exactement → Diapos ; `/trame/sujets` (et dessous) → Sujets. */
export function templateTabOfPath(programId: string, pathname: string): TemplateTabId | null {
  if (pathname === pageHref(programId, "template")) return "slides";
  if (under(pathname, pageHref(programId, "subjects"))) return "subjects";
  return null;
}

/** L'étape d'une page, sous-pages comprises (les sujets restent dans la Trame). */
export function stepOfPath(programId: string, pathname: string): StepId | null {
  return STEPS.find((s) => under(pathname, stepHref(programId, s.id)))?.id ?? null;
}

/** La page du parcours affichée exactement (pas une sous-page). */
export function exactPageOfPath(programId: string, pathname: string): PageId | null {
  return PAGE_ORDER.find((p) => pageHref(programId, p.id) === pathname)?.id ?? null;
}

/**
 * Ancres des zones d'import : « Partir d'un exemple » sur la page Apparence,
 * l'import de sujets sur la page Sujets, la trame depuis un prompt sur la page Trame.
 */
export const IMPORT_ANCHORS = { brand: "importer-apparence", subjects: "importer-sujets", template: "import-prompt" } as const;
