import { createHash } from "node:crypto";
import type { ClassificationOutcome } from "@/domain/contracts";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import {
  assessFinalDeck,
  enforceProblem,
  findUnsourcedFigures,
  pickBetterDeck,
  qualityFeedback,
  qualityWarnings,
  unsourcedFigureWarning,
  type FinalDeckQuality,
} from "@/domain/deck-quality";
import { buildFreeFinalDeck } from "@/domain/free";
import { buildClassificationPrompt, buildFinalDeckPrompt, withRetryFeedback } from "@/domain/prompts";
import type { DeckSpec, ProblemInput } from "@/domain/schemas";
import type { AiProvider } from "../ai/types";
import { AiUnavailableError, isAppError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeAiQuotaFor, consumeFreeEngineQuota, refundAiQuotaFor, type AiBilling } from "../rate-limit";
import {
  createFinalDeck,
  findRecentFinalDeck,
  getFinalDeckContext,
  getGenerationContext,
  type FinalDeckContext,
} from "../repo/decks";
import type { DeckEngine } from "../repo/types";
import { singleFlight } from "../single-flight";
import { classifyWithFallback } from "./classification";

/**
 * Logique métier du jour J, indépendante de Next et de HTTP : l'appelant
 * fournit l'utilisateur, le fournisseur IA et le logger. Ordre immuable :
 *   1. lecture autorisée du contexte (requête filtrée par propriétaire ; le
 *      sujet, s'il y en a un, est cherché DANS ce programme),
 *   2. quota (IA, ou limite anti-abus légère pour le moteur gratuit),
 *   3. rédaction : appel IA HORS de toute transaction, ou moteur gratuit (pur) ;
 *      deck final IA : contrôle qualité, au plus UNE nouvelle tentative (une
 *      unité de quota de plus), puis corrections déterministes (problématique),
 *   4. écriture courte qui revérifie la propriété (le sujet a pu disparaître),
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

/**
 * Reconnaissance du sujet. Moteur gratuit → sans IA. Moteur IA → tentative IA
 * (quota compris) avec repli automatique sur la reconnaissance sans IA en cas
 * d'échec ; `source` et `fallbackReason` le disent à l'interface. Les notes des
 * sujets ne sont jamais envoyées à la reconnaissance.
 */
export async function classifyProblem(
  userId: string,
  programId: string,
  input: ProblemInput,
  deps: GenerationDeps,
): Promise<ClassificationOutcome> {
  const g = await getGenerationContext(userId, programId);
  if (g.themes.length === 0) {
    throw new ValidationError("Ce projet n'a pas de sujet : la reconnaissance est inutile.");
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

export interface FinalDeckInput {
  programId: string;
  /** Sujet retenu ; null = deck sans sujet (problématique et trame seules). */
  themeId: string | null;
  problem: string;
}

/**
 * Deck du jour J à partir de la trame, du sujet retenu (et de ses notes) ou
 * d'aucun sujet, et de la problématique. Rejouable : deux demandes identiques
 * simultanées n'en font qu'une (singleFlight), une demande rejouée dans les
 * 2 minutes renvoie le deck déjà produit (`reused`).
 */
export async function generateFinalDeck(
  userId: string,
  input: FinalDeckInput,
  deps: GenerationDeps,
): Promise<{ deckId: string; warnings: string[]; reused: boolean }> {
  const problemHash = createHash("sha256").update(input.problem).digest("hex").slice(0, 16);
  const engine = engineOf(deps);
  // Le moteur et l'absence de sujet font partie de la clé : rien ne fusionne entre deux demandes différentes.
  const key = `final:${userId}:${input.programId}:${input.themeId ?? "-"}:${problemHash}:${engine}`;
  return singleFlight(key, async () => {
    // Autorisation : programme possédé, sujet de CE programme (sinon introuvable).
    const g = await getFinalDeckContext(userId, input.programId, input.themeId);

    const recent = await findRecentFinalDeck(userId, { ...input, sinceMs: FINAL_DECK_DEDUP_MS, engine });
    if (recent) {
      deps.log.info("deck.final_reused", { deckId: recent.deckId });
      return { deckId: recent.deckId, warnings: [], reused: true };
    }

    await consumeGenerationQuota(userId, deps);
    let spec: DeckSpec;
    /** Avertissements de qualité, affichés après les écarts à la trame. */
    const warnings: string[] = [];
    let attempts = 1;
    if (deps.mode === "free") {
      spec = buildFreeFinalDeck(g.ctx, g.subject, input.problem);
    } else {
      const drafted = await draftFinalDeckWithRetry(userId, deps, g, input.problem);
      attempts = drafted.attempts;
      warnings.push(...drafted.warnings);
      // La problématique TIRÉE est écrite par le code (couverture, diapo problématique), quoi qu'ait produit le modèle.
      spec = enforceProblem(drafted.spec, {
        template: g.ctx.template,
        problem: input.problem,
        themeName: g.subject?.name ?? null,
        programName: g.ctx.name,
      });
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
 * Ollama et le mock) : si le deck sort des seuils (diapos par ligne, recopie
 * du contenu type, conclusion hors problématique), UNE nouvelle tentative
 * reçoit un retour explicite. Elle consomme sa propre unité de quota (2 appels
 * = 2 consommations, restituée si rien n'a été calculé). Le meilleur des deux
 * est gardé ; s'il reste hors seuil, des avertissements le disent. Un échec de
 * la seconde tentative (quota, panne) ne perd jamais la première.
 */
async function draftFinalDeckWithRetry(
  userId: string,
  deps: AiGenerationDeps,
  g: FinalDeckContext,
  problem: string,
): Promise<DraftedDeck> {
  const template = g.ctx.template;
  const lang = template.language;
  const ai = deps.ai;
  const billing = deps.billing ?? "server";
  const subject = g.subject;
  const prompt = (feedback: string | null, subjectNotesMax?: number) => {
    const base = buildFinalDeckPrompt(g.ctx, subject, problem, subjectNotesMax === undefined ? {} : { subjectNotesMax });
    return feedback ? withRetryFeedback(base, feedback, lang) : base;
  };
  const call = (feedback: string | null) =>
    billedAiCall(userId, deps, () =>
      ai.generateDeck(prompt(feedback), {
        template,
        subject,
        programName: g.ctx.name,
        problem,
        // Pour un modèle à contexte borné : mêmes consignes (et même retour), notes du sujet raccourcies.
        compactPrompt: subject?.notes.trim() ? (subjectNotesMax) => prompt(feedback, subjectNotesMax) : undefined,
      }),
    );
  const assess = (spec: DeckSpec) => ({ spec, quality: assessFinalDeck(spec, { template, problem }) });
  const logQuality = (attempt: number, q: FinalDeckQuality) =>
    deps.log.info("deck.final_quality", {
      themeId: subject?.id ?? null,
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
    deps.log.warn("deck.final_retry_failed", { themeId: subject?.id ?? null, code: error.code });
    warnings.push(`Nouvelle tentative impossible (${error.userMessage}) : le premier résultat est conservé.`);
  }
  if (!best.quality.ok) warnings.push(...qualityWarnings(best.quality));
  return { ...best, warnings, attempts };
}
