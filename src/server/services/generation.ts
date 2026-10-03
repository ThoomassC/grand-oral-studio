import { createHash } from "node:crypto";
import type { ClassificationOutcome } from "@/domain/contracts";
import { checkDeckAgainstTemplate, completeThinNotes } from "@/domain/deck";
import { buildFreeFinalDeck, buildFreeSkeleton } from "@/domain/free";
import { buildClassificationPrompt, buildFinalDeckPrompt, buildSkeletonPrompt } from "@/domain/prompts";
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
 *   3. rédaction : appel IA HORS de toute transaction, ou moteur gratuit (pur),
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
      spec = await billedAiCall(userId, deps, () =>
        ai.generateDeck(prompt, { template: g.ctx.template, theme: g.theme, programName: g.ctx.name }),
      );
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
    if (deps.mode === "free") {
      spec = buildFreeFinalDeck(g.ctx, g.theme, g.skeleton, input.problem);
    } else {
      const prompt = buildFinalDeckPrompt(g.ctx, g.theme, g.skeleton, input.problem);
      const ai = deps.ai;
      spec = await billedAiCall(userId, deps, () =>
        ai.generateDeck(prompt, {
          template: g.ctx.template,
          theme: g.theme,
          programName: g.ctx.name,
          problem: input.problem,
          skeleton: g.skeleton,
          // Pour un modèle à contexte borné : mêmes consignes, notes du squelette raccourcies.
          compactPrompt: g.skeleton
            ? (skeletonNotesMax) => buildFinalDeckPrompt(g.ctx, g.theme, g.skeleton, input.problem, { skeletonNotesMax })
            : undefined,
        }),
      );
    }
    const warnings = checkDeckAgainstTemplate(spec, g.ctx.template);
    if (warnings.length > 0) deps.log.warn("deck.template_mismatch", { themeId: input.themeId, kind: "FINAL", warnings });
    if (deps.mode !== "free") {
      // Un modèle local rend parfois des notes vides ou réduites à une consigne : le squelette rédigé prend le relais.
      const completed = completeThinNotes(spec, g.skeleton);
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
        warnings.push(
          `Notes trop courtes non complétées dans ${completed.skippedSections.length > 1 ? "les sections" : "la section"} ${completed.skippedSections.map((id) => `« ${id} »`).join(", ")} : le nombre de diapos diffère du squelette. Rédigez-les.`,
        );
      }
    }

    const { deckId } = await createFinalDeck(userId, { ...input, spec, engine });
    deps.log.info("deck.final_saved", { deckId, themeId: input.themeId, engine });
    return { deckId, warnings, reused: false };
  });
}
