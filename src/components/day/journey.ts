import type { ClassificationOutcome } from "@/domain/contracts";

/**
 * Logique pure du parcours du jour J : nombre de sujets, choix du sujet
 * envoyé à la génération et brouillon conservé dans sessionStorage.
 */

/** Choix « Un autre sujet du projet » (le sujet est alors pris dans la liste). */
export const OTHER = "__other__";
/** Choix « Sans sujet » : le diaporama part de la problématique et de la trame seules. */
export const NONE = "__none__";

/**
 * 0 sujet : pas d'étape « sujet » ; 1 sujet : pas de reconnaissance, le sujet
 * est présélectionné ; plusieurs : reconnaissance du sujet de la problématique.
 */
export type SubjectMode = "none" | "single" | "many";

export function subjectMode(count: number): SubjectMode {
  if (count <= 0) return "none";
  return count === 1 ? "single" : "many";
}

/** Ce qui est conservé dans sessionStorage (rechargement, onglet fermé par erreur). */
export interface Draft {
  problem: string;
  hintedThemeId: string;
  stage: "input" | "chosen";
  result: ClassificationOutcome | null;
  /** Identifiant de sujet, `OTHER`, `NONE`, ou "" tant que rien n'est choisi. */
  choice: string;
  otherThemeId: string;
}

/**
 * Sujet envoyé à `generateFinalDeck` : un identifiant, `null` pour « Sans
 * sujet », `undefined` tant que rien n'est choisi (la génération est alors
 * impossible : le serveur refuse `undefined`).
 */
export function selectedSubject(choice: string, otherThemeId: string): string | null | undefined {
  if (choice === NONE) return null;
  const id = choice === OTHER ? otherThemeId : choice;
  return id === "" ? undefined : id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseResult(value: unknown): ClassificationOutcome | null {
  if (!isRecord(value) || !Array.isArray(value.ranked)) return null;
  const ranked = value.ranked.filter(
    (r): r is ClassificationOutcome["ranked"][number] =>
      isRecord(r) && typeof r.themeId === "string" && typeof r.themeName === "string" && typeof r.confidence === "number",
  );
  return {
    reformulatedProblem: typeof value.reformulatedProblem === "string" ? value.reformulatedProblem : "",
    ranked: ranked.map((r) => ({ ...r, rationale: typeof r.rationale === "string" ? r.rationale : "" })),
    // Brouillon antérieur au moteur gratuit : reconnaissance par IA, sans repli.
    source: value.source === "free" ? "free" : "ai",
    fallbackReason: typeof value.fallbackReason === "string" ? value.fallbackReason : null,
  };
}

/** Brouillon relu depuis sessionStorage (valeur JSON quelconque), ou null s'il est inexploitable. */
export function parseDraft(value: unknown): Draft | null {
  if (!isRecord(value) || typeof value.problem !== "string") return null;
  return {
    problem: value.problem,
    hintedThemeId: typeof value.hintedThemeId === "string" ? value.hintedThemeId : "",
    stage: value.stage === "chosen" ? "chosen" : "input",
    result: parseResult(value.result),
    choice: typeof value.choice === "string" ? value.choice : "",
    otherThemeId: typeof value.otherThemeId === "string" ? value.otherThemeId : "",
  };
}

/**
 * Confronte un brouillon aux sujets actuels du projet (un sujet a pu être
 * supprimé, le brouillon peut dater d'une version précédente) : un choix
 * qui ne désigne plus rien ramène à l'étape 1, problématique conservée.
 */
export function restoreDraft(draft: Draft | null, themeIds: readonly string[]): Draft | null {
  if (!draft) return null;
  const known = new Set(themeIds);
  const result = draft.result
    ? { ...draft.result, ranked: draft.result.ranked.filter((r) => known.has(r.themeId)) }
    : null;
  const restored: Draft = { ...draft, hintedThemeId: known.has(draft.hintedThemeId) ? draft.hintedThemeId : "", result };
  if (restored.stage === "input") return restored;

  const { choice, otherThemeId } = restored;
  if (choice === NONE || known.has(choice)) return restored;
  if (choice === OTHER && known.has(otherThemeId)) {
    // « Un autre sujet » n'est proposé qu'à partir de deux sujets : avec un seul, il devient le sujet coché.
    return themeIds.length >= 2 ? restored : { ...restored, choice: otherThemeId, otherThemeId: "" };
  }
  return { ...restored, stage: "input", result: null, choice: "", otherThemeId: "" };
}
