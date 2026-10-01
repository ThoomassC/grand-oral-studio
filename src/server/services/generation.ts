import { createHash } from "node:crypto";
import type { ClassificationResult } from "@/domain/contracts";
import { normalizeClassification } from "@/domain/classification";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { buildClassificationPrompt, buildFinalDeckPrompt, buildSkeletonPrompt } from "@/domain/prompts";
import type { ProblemInput } from "@/domain/schemas";
import type { AiProvider } from "../ai/types";
import { isAppError, NotFoundError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeAiQuota } from "../rate-limit";
import {
  createFinalDeck,
  findRecentFinalDeck,
  getGenerationContext,
  getThemeGenerationContext,
  listSkeletonThemeIds,
  upsertSkeleton,
} from "../repo/decks";
import { singleFlight } from "../single-flight";

/**
 * Logique métier de génération, indépendante de Next et de HTTP : l'appelant
 * fournit l'utilisateur, le fournisseur IA et le logger. Ordre immuable :
 *   1. lecture autorisée du contexte (requête filtrée par propriétaire),
 *   2. quota,
 *   3. appel IA — HORS de toute transaction,
 *   4. écriture courte qui revérifie la propriété (le thème a pu disparaître).
 */

export interface GenerationDeps {
  ai: AiProvider;
  log: Logger;
}

export interface SkeletonResult {
  deckId: string;
  /** Programme du thème (pour l'invalidation des pages). */
  programId: string;
  /** Écarts entre le deck produit et le gabarit (non bloquants). */
  warnings: string[];
}

export async function generateSkeleton(userId: string, themeId: string, deps: GenerationDeps): Promise<SkeletonResult> {
  return singleFlight(`skeleton:${userId}:${themeId}`, async () => {
    const g = await getThemeGenerationContext(userId, themeId);
    await consumeAiQuota(userId, 1);

    const prompt = buildSkeletonPrompt(g.ctx, g.theme);
    const spec = await deps.ai.generateDeck(prompt, {
      template: g.ctx.template,
      theme: g.theme,
      programName: g.ctx.name,
    });
    const warnings = checkDeckAgainstTemplate(spec, g.ctx.template);
    if (warnings.length > 0) deps.log.warn("deck.template_mismatch", { themeId, kind: "SKELETON", warnings });

    const { deckId } = await upsertSkeleton(userId, themeId, spec);
    deps.log.info("deck.skeleton_saved", { themeId, deckId, provider: deps.ai.name });
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

export async function classifyProblem(
  userId: string,
  programId: string,
  input: ProblemInput,
  deps: GenerationDeps,
): Promise<ClassificationResult> {
  const g = await getGenerationContext(userId, programId);
  if (g.themes.length === 0) {
    throw new ValidationError("Ajoutez au moins un thème au programme avant la reconnaissance.");
  }
  await consumeAiQuota(userId, 1);

  const prompt = buildClassificationPrompt(g.ctx, input.problem);
  const raw = await deps.ai.classify(prompt, {
    themes: g.themes,
    problem: input.problem,
    hintedThemeId: input.hintedThemeId,
  });
  // Filtre les ids inventés ou étrangers au programme, borne et trie.
  return normalizeClassification(raw, g.themes, input.hintedThemeId);
}

/** Fenêtre pendant laquelle une même demande de deck final renvoie le deck déjà produit. */
export const FINAL_DECK_DEDUP_MS = 2 * 60 * 1000;

export async function generateFinalDeck(
  userId: string,
  input: { programId: string; themeId: string; problem: string },
  deps: GenerationDeps,
): Promise<{ deckId: string; warnings: string[]; reused: boolean }> {
  const problemHash = createHash("sha256").update(input.problem).digest("hex").slice(0, 16);
  return singleFlight(`final:${userId}:${input.themeId}:${problemHash}`, async () => {
    const g = await getThemeGenerationContext(userId, input.themeId);
    // Le thème doit appartenir au programme annoncé (sinon : introuvable).
    if (g.programId !== input.programId) throw new NotFoundError("thème");

    const recent = await findRecentFinalDeck(userId, { ...input, sinceMs: FINAL_DECK_DEDUP_MS });
    if (recent) {
      deps.log.info("deck.final_reused", { deckId: recent.deckId });
      return { deckId: recent.deckId, warnings: [], reused: true };
    }

    await consumeAiQuota(userId, 1);
    const prompt = buildFinalDeckPrompt(g.ctx, g.theme, g.skeleton, input.problem);
    const spec = await deps.ai.generateDeck(prompt, {
      template: g.ctx.template,
      theme: g.theme,
      programName: g.ctx.name,
      problem: input.problem,
      skeleton: g.skeleton,
    });
    const warnings = checkDeckAgainstTemplate(spec, g.ctx.template);
    if (warnings.length > 0) deps.log.warn("deck.template_mismatch", { themeId: input.themeId, kind: "FINAL", warnings });

    const { deckId } = await createFinalDeck(userId, { ...input, spec });
    deps.log.info("deck.final_saved", { deckId, themeId: input.themeId, provider: deps.ai.name });
    return { deckId, warnings, reused: false };
  });
}
