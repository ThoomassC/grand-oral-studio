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
import type { AiProvider, CallOptions } from "../ai/types";
import { isAppError, isRefundableAiError, ValidationError } from "../errors";
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

// ---------------------------------------------------------------------------
// Échéance de la génération du jour J
// ---------------------------------------------------------------------------

/** Échéance par défaut d'une génération (la page qui la déclenche porte `maxDuration = 300`). */
export const GENERATION_DEADLINE_DEFAULT_MS = 280_000;
export const GENERATION_DEADLINE_MIN_MS = 60_000;
/** Au-delà, la plateforme couperait la requête avant l'échéance (maxDuration = 300 s). */
export const GENERATION_DEADLINE_MAX_MS = 295_000;
/** Une seconde tentative de rédaction n'est engagée que s'il reste au moins ce temps. */
export const RETRY_MIN_REMAINING_MS = 120_000;
/** Budget maximal d'un appel de rédaction. */
export const CALL_BUDGET_MAX_MS = 240_000;
/** Marge gardée après un appel (contrôle qualité, écriture, réponse). */
export const CALL_BUDGET_MARGIN_MS = 10_000;
/** Plancher d'un budget d'appel (un appel lancé a toujours un minimum de temps). */
const CALL_BUDGET_FLOOR_MS = 5_000;

/** AI_GENERATION_DEADLINE_MS : entier en ms, borné ; illisible ou absent → 280 s. */
export function readGenerationDeadline(raw: string | undefined): number {
  const value = raw?.trim() ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return GENERATION_DEADLINE_DEFAULT_MS;
  return Math.min(GENERATION_DEADLINE_MAX_MS, Math.max(GENERATION_DEADLINE_MIN_MS, Math.floor(value)));
}

/** Lu une seule fois, au chargement du module. */
const GENERATION_DEADLINE_MS = readGenerationDeadline(process.env.AI_GENERATION_DEADLINE_MS);

/** Budget d'un appel : min(240 s, restant − 10 s), jamais sous un plancher de 5 s. */
export function callBudgetMs(remainingMs: number): number {
  return Math.max(CALL_BUDGET_FLOOR_MS, Math.min(CALL_BUDGET_MAX_MS, remainingMs - CALL_BUDGET_MARGIN_MS));
}

/** Horloge et échéance injectables (tests). */
export interface GenerationTiming {
  /** Horloge en ms ; défaut Date.now. */
  now?: () => number;
  /** Échéance totale ; défaut AI_GENERATION_DEADLINE_MS (lu une fois). */
  deadlineMs?: number;
}

/**
 * Échéance d'une génération, démarrée à l'entrée du service. `null` : sans
 * échéance (Ollama : un modèle local lent n'est jamais interrompu, la page ne
 * dépend pas d'une plateforme qui coupe la requête).
 */
interface Deadline {
  remaining(): number;
}

function startDeadline(deps: GenerationDeps): Deadline | null {
  if (deps.mode === "free" || deps.ai.engine === "ollama") return null;
  const now = deps.timing?.now ?? Date.now;
  const end = now() + (deps.timing?.deadlineMs ?? GENERATION_DEADLINE_MS);
  return { remaining: () => end - now() };
}

function callOptions(deadline: Deadline | null): CallOptions | undefined {
  return deadline ? { budgetMs: callBudgetMs(deadline.remaining()) } : undefined;
}

/** Rédaction par un fournisseur IA (Claude, Mistral, Gemini, OpenAI, Ollama, mock). */
export interface AiGenerationDeps {
  mode?: "ai";
  ai: AiProvider;
  log: Logger;
  /**
   * Qui paie l'appel : "user" (sa propre clé → quota propre, sans plafond
   * global), "local" (Ollama) ou "server" (défaut : quota utilisateur + plafond global).
   */
  billing?: AiBilling;
  timing?: GenerationTiming;
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
 * refusée, file d'attente pleine, débit limité par le fournisseur — 429),
 * l'unité de quota est restituée.
 */
async function billedAiCall<T>(userId: string, deps: AiGenerationDeps, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isRefundableAiError(error)) {
      // Un échec du remboursement est journalisé : il ne masque jamais l'erreur d'origine.
      try {
        await refundAiQuotaFor(deps.billing ?? "server", userId, 1);
        deps.log.info("ai.quota_refunded", { code: isAppError(error) ? error.code : null });
      } catch (refundError) {
        deps.log.error("ai.quota_refund_failed", { code: isAppError(error) ? error.code : null, error: refundError });
      }
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
  /** Deck d'entraînement (true) ou du jour J (défaut). */
  practice?: boolean;
  /** Départ du chrono de préparation (déjà borné par l'appelant) ; null = inconnu. */
  prepStartedAt?: Date | null;
}

export interface FinalDeckResult {
  deckId: string;
  warnings: string[];
  reused: boolean;
  /** Moteur qui a produit le deck (ou qui l'aurait produit, pour un deck réutilisé). */
  engine: DeckEngine;
}

/**
 * Deck du jour J à partir de la trame, du sujet retenu (et de ses notes) ou
 * d'aucun sujet, et de la problématique. Rejouable : deux demandes identiques
 * simultanées n'en font qu'une (singleFlight), une demande rejouée dans les
 * 2 minutes renvoie le deck déjà produit (`reused`).
 */
export async function generateFinalDeck(userId: string, input: FinalDeckInput, deps: GenerationDeps): Promise<FinalDeckResult> {
  const problemHash = createHash("sha256").update(input.problem).digest("hex").slice(0, 16);
  const engine = engineOf(deps);
  const practice = input.practice ?? false;
  // Le moteur, l'absence de sujet et l'entraînement font partie de la clé : rien ne fusionne entre deux demandes différentes.
  const key = `final:${userId}:${input.programId}:${input.themeId ?? "-"}:${problemHash}:${engine}:${practice ? "practice" : "exam"}`;
  return singleFlight(key, async () => {
    const deadline = startDeadline(deps);
    // Autorisation : programme possédé, sujet de CE programme (sinon introuvable).
    const g = await getFinalDeckContext(userId, input.programId, input.themeId);

    const recent = await findRecentFinalDeck(userId, {
      programId: input.programId,
      themeId: input.themeId,
      problem: input.problem,
      sinceMs: FINAL_DECK_DEDUP_MS,
      engine,
      practice,
    });
    if (recent) {
      deps.log.info("deck.final_reused", { deckId: recent.deckId });
      return { deckId: recent.deckId, warnings: [], reused: true, engine };
    }

    await consumeGenerationQuota(userId, deps);
    let spec: DeckSpec;
    /** Avertissements de qualité, affichés après les écarts à la trame. */
    const warnings: string[] = [];
    let attempts = 1;
    if (deps.mode === "free") {
      spec = buildFreeFinalDeck(g.ctx, g.subject, input.problem);
    } else {
      const drafted = await draftFinalDeckWithRetry(userId, deps, g, input.problem, deadline);
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

    const { deckId } = await createFinalDeck(userId, {
      programId: input.programId,
      themeId: input.themeId,
      problem: input.problem,
      spec,
      engine,
      practice,
      prepStartedAt: input.prepStartedAt ?? null,
      createdById: userId,
    });
    deps.log.info("deck.final_saved", { deckId, themeId: input.themeId, engine, attempts, practice });
    return { deckId, warnings: [...mismatch, ...warnings], reused: false, engine };
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
 * Rédaction IA du deck final avec contrôle qualité (même code pour tous les
 * fournisseurs, Ollama et le mock) : si le deck sort des seuils (diapos par
 * ligne, recopie du contenu type, conclusion hors problématique), UNE nouvelle
 * tentative reçoit un retour explicite. Elle consomme sa propre unité de quota
 * (2 appels = 2 consommations, restituée si rien n'a été calculé) et n'est
 * engagée que s'il reste au moins 120 s avant l'échéance. Chaque appel reçoit
 * le budget min(240 s, restant − 10 s). Le meilleur des deux est gardé ; s'il
 * reste hors seuil, des avertissements le disent. Un échec de la seconde
 * tentative (quota atteint, toute erreur de l'appel IA) ne perd jamais la
 * première ; seule une panne hors appel IA (base) remonte.
 */
async function draftFinalDeckWithRetry(
  userId: string,
  deps: AiGenerationDeps,
  g: FinalDeckContext,
  problem: string,
  deadline: Deadline | null,
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
      }, callOptions(deadline)),
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
  const remaining = deadline?.remaining() ?? Number.POSITIVE_INFINITY;
  if (remaining < RETRY_MIN_REMAINING_MS) {
    // Pas de quota consommé : la seconde tentative n'est pas engagée.
    deps.log.warn("deck.final_retry_skipped", { themeId: subject?.id ?? null, remainingMs: Math.max(0, Math.round(remaining)) });
    warnings.push("Pas de nouvelle tentative : le temps de génération est presque écoulé. Le premier résultat est conservé.");
    warnings.push(...qualityWarnings(first.quality));
    return { ...first, warnings, attempts };
  }
  const keepFirst = (reason: string) => warnings.push(`Nouvelle tentative impossible (${reason}) : le premier résultat est conservé.`);
  let quotaOk = true;
  try {
    await consumeAiQuotaFor(billing, userId, 1);
  } catch (error) {
    // Panne de base hors appel IA : remonte. Quota atteint (erreur attendue) : la première tentative reste.
    if (!isAppError(error)) throw error;
    quotaOk = false;
    deps.log.warn("deck.final_retry_failed", { themeId: subject?.id ?? null, code: error.code });
    keepFirst(error.userMessage);
  }
  if (quotaOk) {
    attempts = 2;
    let second: ReturnType<typeof assess> | null = null;
    try {
      second = assess(await call(qualityFeedback(first.quality, template)));
    } catch (error) {
      // Toute erreur de l'appel IA (attendue ou non) garde la première version, déjà payée.
      if (isAppError(error)) {
        deps.log.warn("deck.final_retry_failed", { themeId: subject?.id ?? null, code: error.code });
        keepFirst(error.userMessage);
      } else {
        deps.log.error("deck.final_retry_failed", { themeId: subject?.id ?? null, error });
        keepFirst("réponse inattendue du rédacteur");
      }
    }
    if (second) {
      logQuality(2, second.quality);
      best = pickBetterDeck(first, second);
    }
  }
  if (!best.quality.ok) warnings.push(...qualityWarnings(best.quality));
  return { ...best, warnings, attempts };
}
