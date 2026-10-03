import { createHash } from "node:crypto";
import type { ClassificationOutcome } from "@/domain/contracts";
import { checkDeckAgainstTemplate, completeThinNotes } from "@/domain/deck";
import {
  assessFinalDeck,
  enforceProblem,
  findUnsourcedFigures,
  neutralizeSkeletonProblem,
  pickBetterDeck,
  qualityFeedback,
  qualityWarnings,
  unsourcedFigureWarning,
  type FinalDeckQuality,
} from "@/domain/deck-quality";
import { buildFreeFinalDeck, buildFreeSkeleton } from "@/domain/free";
import { buildClassificationPrompt, buildFinalDeckPrompt, buildSkeletonPrompt, withRetryFeedback } from "@/domain/prompts";
import type { DeckSpec, ProblemInput } from "@/domain/schemas";
import type { AiProvider } from "../ai/types";
import { AiUnavailableError, isAppError, NotFoundError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeAiQuotaFor, consumeFreeEngineQuota, refundAiQuotaFor, type AiBilling } from "../rate-limit";
import {
  createFinalDeck,
  findRecentFinalDeck,
  getGenerationContext,
  getThemeGenerationContext,
  listSkeletonThemeIds,
  upsertSkeleton,
} from "../repo/decks";
import type { DeckEngine } from "../repo/types";
import { singleFlight } from "../single-flight";
import { classifyWithFallback } from "./classification";

/**
 * Logique métier de génération, indépendante de Next et de HTTP : l'appelant
 * fournit l'utilisateur, le fournisseur IA et le logger. Ordre immuable :
 *   1. lecture autorisée du contexte (requête filtrée par propriétaire),
 *   2. quota (IA, ou limite anti-abus légère pour le moteur gratuit),
 *   3. rédaction : appel IA HORS de toute transaction, ou moteur gratuit (pur) ;
 *      deck final IA : contrôle qualité, au plus UNE nouvelle tentative (une
 *      unité de quota de plus), puis corrections déterministes (problématique),
 *   4. écriture courte qui revérifie la propriété (le thème a pu disparaître),
 *      avec le moteur qui a produit le deck.
 */

/** Rédaction par un fournisseur IA (Claude, Ollama, mock). */
export interface AiGenerationDeps {
  mode?: "ai";
  ai: AiProvider;
  log: Logger;
  /**
   * Qui paie l'appel : "user" (sa propre clé → quota propre, sans plafond
   * global), "local" (Ollama) ou "server" (défaut : quota utilisateur + plafond global).
   */
  billing?: AiBilling;
}

/** Moteur gratuit : sans réseau, instantané, aucun quota IA. */
export interface FreeGenerationDeps {
  mode: "free";
  log: Logger;
  /** Explication affichable quand la reconnaissance a dû se passer d'IA (moteur indisponible). */
  fallbackReason?: string;
}

export type GenerationDeps = AiGenerationDeps | FreeGenerationDeps;

function engineOf(deps: GenerationDeps): DeckEngine {
  return deps.mode === "free" ? "free" : (deps.ai.engine ?? "claude");
}

async function consumeGenerationQuota(userId: string, deps: GenerationDeps): Promise<void> {
  if (deps.mode === "free") await consumeFreeEngineQuota(userId);
  else await consumeAiQuotaFor(deps.billing ?? "server", userId, 1);
}

/**
 * Appel IA facturé : si l'échec prouve que rien n'a été calculé (connexion
 * refusée, file d'attente pleine), l'unité de quota est restituée.
 */
async function billedAiCall<T>(userId: string, deps: AiGenerationDeps, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AiUnavailableError && error.refundable) {
      await refundAiQuotaFor(deps.billing ?? "server", userId, 1);
      deps.log.info("ai.quota_refunded", { detail: error.detail });
    }
    throw error;
  }
}

export interface SkeletonResult {
  deckId: string;
  /** Programme du thème (pour l'invalidation des pages). */
  programId: string;
  /** Écarts entre le deck produit et le gabarit (non bloquants). */
  warnings: string[];
}

export async function generateSkeleton(userId: string, themeId: string, deps: GenerationDeps): Promise<SkeletonResult> {
  // Le moteur fait partie de la clé : deux demandes simultanées de moteurs différents ne fusionnent pas.
  return singleFlight(`skeleton:${userId}:${themeId}:${engineOf(deps)}`, async () => {
    const g = await getThemeGenerationContext(userId, themeId);
    await consumeGenerationQuota(userId, deps);

    let spec: DeckSpec;
    if (deps.mode === "free") {
      spec = buildFreeSkeleton(g.ctx, g.theme);
    } else {
      const prompt = buildSkeletonPrompt(g.ctx, g.theme);
      const ai = deps.ai;
      const drafted = await billedAiCall(userId, deps, () =>
        ai.generateDeck(prompt, { template: g.ctx.template, theme: g.theme, programName: g.ctx.name }),
      );
      // Un squelette ne formule jamais de problématique (le modèle en invente parfois une), et sa couverture
      // porte le titre du sujet, pas le nom du projet. Le moteur gratuit respecte déjà ces deux règles.
      spec = neutralizeSkeletonProblem(drafted, g.ctx.template, { themeName: g.theme.name, programName: g.ctx.name });
    }
    const warnings = checkDeckAgainstTemplate(spec, g.ctx.template);
    if (warnings.length > 0) deps.log.warn("deck.template_mismatch", { themeId, kind: "SKELETON", warnings });

    const engine = engineOf(deps);
    const { deckId } = await upsertSkeleton(userId, themeId, spec, engine);
    deps.log.info("deck.skeleton_saved", { themeId, deckId, engine });
    return { deckId, programId: g.programId, warnings };
  });
}

export type BatchItemResult =
  | { themeId: string; themeName: string; ok: true; deckId: string; warnings: string[] }
  | { themeId: string; themeName: string; ok: false; error: string };

export const SKELETON_CONCURRENCY = 3;

export type BatchMode = "missing" | "all";

/**
 * Génère les squelettes, concurrence bornée ; un échec n'arrête pas les autres.
 * `missing` (défaut) ne traite que les thèmes sans squelette ; `all` régénère tout.
 */
export async function generateAllSkeletons(
  userId: string,
  programId: string,
  deps: GenerationDeps,
  mode: BatchMode = "missing",
): Promise<BatchItemResult[]> {
  const g = await getGenerationContext(userId, programId);
  const done = mode === "missing" ? await listSkeletonThemeIds(userId, programId) : new Set<string>();
  const themes = g.themes.filter((t) => !done.has(t.id));
  const results: BatchItemResult[] = new Array(themes.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < themes.length) {
      const i = next;
      next += 1;
      const theme = themes[i];
      if (!theme) continue;
      try {
        const r = await generateSkeleton(userId, theme.id, deps);
        results[i] = { themeId: theme.id, themeName: theme.name, ok: true, deckId: r.deckId, warnings: r.warnings };
      } catch (error) {
        if (!isAppError(error)) {
          deps.log.error("deck.skeleton_failed", { themeId: theme.id, error });
        }
        results[i] = {
          themeId: theme.id,
          themeName: theme.name,
          ok: false,
          error: isAppError(error) ? error.userMessage : `Erreur inattendue (réf. ${deps.log.correlationId}).`,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SKELETON_CONCURRENCY, themes.length) }, () => worker()));
  return results;
}

/**
 * Reconnaissance du thème. Moteur gratuit → sans IA. Moteur IA → tentative IA
 * (quota compris) avec repli automatique sur la reconnaissance sans IA en cas
 * d'échec ; `source` et `fallbackReason` le disent à l'interface.
 */
export async function classifyProblem(
  userId: string,
  programId: string,
  input: ProblemInput,
  deps: GenerationDeps,
): Promise<ClassificationOutcome> {
  const g = await getGenerationContext(userId, programId);
  if (g.themes.length === 0) {
    throw new ValidationError("Ajoutez au moins un thème au projet avant la reconnaissance.");
  }
  if (deps.mode === "free") {
    await consumeFreeEngineQuota(userId);
    const result = await classifyWithFallback(g.ctx, input, null, deps.log);
    return { ...result, fallbackReason: deps.fallbackReason ?? null };
  }
  const ai = deps.ai;
  return classifyWithFallback(
    g.ctx,
    input,
    async () => {
      await consumeAiQuotaFor(deps.billing ?? "server", userId, 1);
      const prompt = buildClassificationPrompt(g.ctx, input.problem);
      return billedAiCall(userId, deps, () =>
        ai.classify(prompt, { themes: g.themes, problem: input.problem, hintedThemeId: input.hintedThemeId }),
      );
    },
    deps.log,
  );
}

/** Fenêtre pendant laquelle une même demande de deck final renvoie le deck déjà produit. */
export const FINAL_DECK_DEDUP_MS = 2 * 60 * 1000;

export async function generateFinalDeck(
  userId: string,
  input: { programId: string; themeId: string; problem: string },
  deps: GenerationDeps,
): Promise<{ deckId: string; warnings: string[]; reused: boolean }> {
  const problemHash = createHash("sha256").update(input.problem).digest("hex").slice(0, 16);
  return singleFlight(`final:${userId}:${input.themeId}:${problemHash}:${engineOf(deps)}`, async () => {
    const g = await getThemeGenerationContext(userId, input.themeId);
    // Le thème doit appartenir au programme annoncé (sinon : introuvable).
    if (g.programId !== input.programId) throw new NotFoundError("thème");

    const engine = engineOf(deps);
    const recent = await findRecentFinalDeck(userId, { ...input, sinceMs: FINAL_DECK_DEDUP_MS, engine });
    if (recent) {
      deps.log.info("deck.final_reused", { deckId: recent.deckId });
      return { deckId: recent.deckId, warnings: [], reused: true };
    }

    await consumeGenerationQuota(userId, deps);
    let spec: DeckSpec;
    /** Avertissements de qualité, affichés après les écarts au gabarit. */
    const warnings: string[] = [];
    let attempts = 1;
    if (deps.mode === "free") {
      spec = buildFreeFinalDeck(g.ctx, g.theme, g.skeleton, input.problem);
    } else {
      const names = { themeName: g.theme.name, programName: g.ctx.name };
      // Un squelette ancien a pu formuler une autre problématique : elle n'est jamais transmise.
      const skeleton = g.skeleton ? neutralizeSkeletonProblem(g.skeleton, g.ctx.template, names) : null;
      const drafted = await draftFinalDeckWithRetry(userId, deps, { ...g, skeleton }, input.problem);
      attempts = drafted.attempts;
      warnings.push(...drafted.warnings);
      // La problématique TIRÉE est écrite par le code (couverture, diapo problématique), quoi qu'ait produit le modèle.
      spec = enforceProblem(drafted.spec, { template: g.ctx.template, problem: input.problem, ...names });

      // Un modèle local rend parfois des notes vides ou réduites à une consigne : le squelette rédigé prend le relais.
      const completed = completeThinNotes(spec, skeleton);
      spec = completed.deck;
      if (completed.filled.length > 0) {
        deps.log.info("deck.notes_completed_from_skeleton", { themeId: input.themeId, slides: completed.filled.length });
        // Le squelette est générique (rédigé avant la problématique) : la note reprise est un point de départ.
        warnings.push(
          `Notes d'orateur trop courtes reprises du squelette, à adapter à votre problématique (diapo${completed.filled.length > 1 ? "s" : ""} ${completed.filled.join(", ")}).`,
        );
      }
      if (completed.skippedSections.length > 0) {
        deps.log.warn("deck.notes_section_mismatch", { themeId: input.themeId, sections: completed.skippedSections });
        const titles = completed.skippedSections.map((id) => g.ctx.template.sections.find((s) => s.id === id)?.title ?? id);
        warnings.push(
          `Notes trop courtes non complétées dans ${titles.length > 1 ? "les sections" : "la section"} ${titles.map((t) => `« ${t} »`).join(", ")} : le nombre de diapos diffère du squelette. Rédigez-les.`,
        );
      }
      const unsourced = unsourcedFigureWarning(findUnsourcedFigures(spec));
      if (unsourced) warnings.push(unsourced);
    }
    const mismatch = checkDeckAgainstTemplate(spec, g.ctx.template);
    if (mismatch.length > 0) deps.log.warn("deck.template_mismatch", { themeId: input.themeId, kind: "FINAL", warnings: mismatch });

    const { deckId } = await createFinalDeck(userId, { ...input, spec, engine });
    deps.log.info("deck.final_saved", { deckId, themeId: input.themeId, engine, attempts });
    return { deckId, warnings: [...mismatch, ...warnings], reused: false };
  });
}

interface DraftedDeck {
  spec: DeckSpec;
  /** Avertissements de qualité (affichables) : recopie, conclusion, tentative impossible. */
  warnings: string[];
  attempts: 1 | 2;
  quality: FinalDeckQuality;
}

/**
 * Rédaction IA du deck final avec contrôle qualité (même code pour Claude,
 * Ollama et le mock) : si le deck sort des seuils (diapos par section, recopie
 * du squelette, conclusion hors problématique), UNE nouvelle tentative reçoit
 * un retour explicite. Elle consomme sa propre unité de quota (2 appels = 2
 * consommations, restituée si rien n'a été calculé). Le meilleur des deux est
 * gardé ; s'il reste hors seuil, des avertissements le disent. Un échec de la
 * seconde tentative (quota, panne) ne perd jamais la première.
 */
async function draftFinalDeckWithRetry(
  userId: string,
  deps: AiGenerationDeps,
  g: Awaited<ReturnType<typeof getThemeGenerationContext>>,
  problem: string,
): Promise<DraftedDeck> {
  const template = g.ctx.template;
  const lang = template.language;
  const ai = deps.ai;
  const billing = deps.billing ?? "server";
  const prompt = (feedback: string | null, skeletonDetailMax?: number) => {
    const base = buildFinalDeckPrompt(g.ctx, g.theme, g.skeleton, problem, skeletonDetailMax === undefined ? {} : { skeletonDetailMax });
    return feedback ? withRetryFeedback(base, feedback, lang) : base;
  };
  const call = (feedback: string | null) =>
    billedAiCall(userId, deps, () =>
      ai.generateDeck(prompt(feedback), {
        template,
        theme: g.theme,
        programName: g.ctx.name,
        problem,
        skeleton: g.skeleton,
        // Pour un modèle à contexte borné : mêmes consignes (et même retour), trame du squelette raccourcie.
        compactPrompt: g.skeleton ? (skeletonDetailMax) => prompt(feedback, skeletonDetailMax) : undefined,
      }),
    );
  const assess = (spec: DeckSpec) => ({ spec, quality: assessFinalDeck(spec, { template, skeleton: g.skeleton, problem }) });
  const logQuality = (attempt: number, q: FinalDeckQuality) =>
    deps.log.info("deck.final_quality", {
      themeId: g.theme.id,
      attempt,
      ok: q.ok,
      sectionGaps: q.sectionGaps.length,
      notesCopyRate: Math.round(q.notesCopyRate * 100) / 100,
      notesToRewrite: q.notesToRewrite.length,
      bulletsCopyRate: Math.round(q.bulletsCopyRate * 100) / 100,
      problemCoverage: Math.round(q.problemCoverage * 100) / 100,
    });

  const first = assess(await call(null));
  logQuality(1, first.quality);
  if (first.quality.ok) return { ...first, warnings: [], attempts: 1 };

  const warnings: string[] = [];
  let best = first;
  let attempts: 1 | 2 = 1;
  try {
    await consumeAiQuotaFor(billing, userId, 1);
    attempts = 2;
    const second = assess(await call(qualityFeedback(first.quality, template)));
    logQuality(2, second.quality);
    best = pickBetterDeck(first, second);
  } catch (error) {
    // Bug ou panne de base : remonte. Erreur attendue (quota, IA indisponible ou hors contrat) : la première tentative reste.
    if (!isAppError(error)) throw error;
    deps.log.warn("deck.final_retry_failed", { themeId: g.theme.id, code: error.code });
    warnings.push(`Nouvelle tentative impossible (${error.userMessage}) : le premier résultat est conservé.`);
  }
  if (!best.quality.ok) warnings.push(...qualityWarnings(best.quality));
  return { ...best, warnings, attempts };
}
