import {
  engineLabel,
  SELECTABLE_PROVIDERS,
  type CloudProvider,
  type EngineId,
  type KeySource,
  type SelectableProvider,
} from "@/domain/ai-providers";
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

// ---------------------------------------------------------------------------
// v1.2 : brouillon par mode, repli en un clic, tirage d'une problématique
// ---------------------------------------------------------------------------

/** Brouillon du parcours : l'entraînement a le sien (il n'écrase pas celui du jour J). */
export function draftKey(programId: string, practice: boolean): string {
  const base = `grand-oral-studio:jour-j:${programId}`;
  return practice ? `${base}:entrainement` : base;
}

/** Rédacteur ponctuel d'une génération (même forme que EngineOverride côté serveur : jamais Claude ni OpenAI). */
export type WriterOverride = { engine: "free" } | { engine: SelectableProvider; keySource: KeySource };

/** Une connexion utilisable pour un repli : clé personnelle ou clé d'équipe d'un fournisseur. */
export interface EngineChoice {
  override: { engine: SelectableProvider; keySource: KeySource };
  /** « Mistral (votre clé) », « Gemini (clé d'équipe) ». */
  label: string;
}

/**
 * Connexions proposées au repli, dans l'ordre des fournisseurs proposés : pour
 * chacun, la clé personnelle enregistrée puis la clé d'équipe disponible. Une
 * connexion héritée (Claude, OpenAI) n'est jamais proposée : ces fournisseurs ne
 * sont plus proposés depuis la 1.2 (le serveur refuserait la surcharge).
 */
export function engineChoices(connections: readonly CloudProvider[], team: readonly CloudProvider[]): EngineChoice[] {
  const out: EngineChoice[] = [];
  for (const provider of SELECTABLE_PROVIDERS) {
    if (connections.includes(provider)) {
      out.push({ override: { engine: provider, keySource: "user" }, label: `${engineLabel(provider)} (votre clé)` });
    }
    if (team.includes(provider)) {
      out.push({ override: { engine: provider, keySource: "server" }, label: `${engineLabel(provider)} (clé d'équipe)` });
    }
  }
  return out;
}

/** Codes d'échec dus au rédacteur : le panneau d'erreur propose alors un repli. */
export function offersFallback(code: string | undefined): boolean {
  return code !== undefined && (code.startsWith("AI_") || code === "ENGINE_UNAVAILABLE" || code === "RATE_LIMITED");
}

/** Rédacteur d'une tentative : moteur et origine de la clé (null hors fournisseur cloud). */
export interface AttemptedWriter {
  engine: EngineId | "mock";
  keySource: KeySource | null;
}

/** Les autres connexions que celle qui vient d'échouer. */
export function otherChoices(choices: readonly EngineChoice[], attempted: AttemptedWriter): EngineChoice[] {
  return choices.filter((c) => !(c.override.engine === attempted.engine && c.override.keySource === attempted.keySource));
}

export interface DrawnProblem {
  problem: string;
  themeId: string;
}

/**
 * Tire une problématique parmi celles enregistrées sur les sujets (`random`
 * dans [0, 1[, Math.random côté appelant) ; null s'il n'y en a aucune.
 */
export function drawProblem(themes: readonly { id: string; problems?: readonly string[] }[], random: number): DrawnProblem | null {
  const pool = themes.flatMap((t) => (t.problems ?? []).filter((p) => p.trim() !== "").map((problem) => ({ problem, themeId: t.id })));
  if (pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random * pool.length)));
  return pool[index] ?? null;
}
