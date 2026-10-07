"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RehearsalInputSchema, type RehearsalInput } from "@/domain/rehearsal";
import { getEngineForUser, type ResolvedEngine } from "../ai";
import { AppError, isRefundableAiError, RateLimitedError } from "../errors";
import { consumeAiQuotaFor, consumeFreeEngineQuota, consumeQuota, refundAiQuotaFor, type QuotaPolicy } from "../rate-limit";
import * as decksRepo from "../repo/decks";
import * as questionsRepo from "../repo/questions";
import type { QuestionView, ReviewStatus } from "../repo/questions";
import * as rehearsalsRepo from "../repo/rehearsals";
import type { RehearsalView } from "../repo/rehearsals";
import type { DeckEngine } from "../repo/types";
import * as juryQuestions from "../services/jury-questions";
import type { JuryPromptContext, JuryQuestionsGenerator } from "../services/jury-questions";
import { IdSchema, parseInput } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

/**
 * Entraînement : répétitions chronométrées et questions du jury. Couche de
 * transport fine (validation zod des entrées, session, quota, invalidation) au-dessus
 * de ../repo/rehearsals.ts, ../repo/questions.ts et ../services/jury-questions.ts,
 * qui vérifient le rôle sur le diaporama visé dans leurs requêtes.
 */

/** Répétitions enregistrées par utilisateur : borne les écritures, sans gêner un usage réel. */
const REHEARSAL_QUOTA: QuotaPolicy = { limit: 120, windowSeconds: 3600 };
/** Marquages de questions par utilisateur (un clic = une écriture). */
const REVIEW_QUOTA: QuotaPolicy = { limit: 1200, windowSeconds: 3600 };

/** Quota d'entraînement atteint (message propre : RateLimitedError parle de générations). */
class PracticeRateLimitedError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;
  constructor(retryAfterSeconds: number) {
    super(`Trop d'enregistrements en peu de temps. Réessayez dans ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} min.`);
  }
}

async function consumePracticeQuota(key: string, policy: QuotaPolicy): Promise<void> {
  try {
    await consumeQuota(key, 1, policy, "user");
  } catch (error) {
    if (error instanceof RateLimitedError) throw new PracticeRateLimitedError(error.retryAfterSeconds);
    throw error;
  }
}

const ReviewStatusSchema = z.enum(["known", "to_review"], { message: "Statut de question inconnu." });

/** Questions d'un diaporama (page des questions) ; fin d'invalidation après un marquage ou une préparation. */
function questionsPath(programId: string, deckId: string): string {
  return `/projets/${programId}/decks/${deckId}/questions`;
}

/**
 * Enregistre une répétition (lecteur et plus). La saisie doit compter un temps par
 * diapo du diaporama actuel (vérifié par le dépôt, sous verrou).
 */
export async function saveRehearsal(deckId: string, input: RehearsalInput): Promise<ActionResult<{ rehearsal: RehearsalView }>> {
  return runAction("saveRehearsal", async ({ user }) => {
    const id = parseInput(IdSchema, deckId);
    const value = parseInput(RehearsalInputSchema, input);
    await consumePracticeQuota(`rehearsal:${user.id}`, REHEARSAL_QUOTA);
    const { programId, rehearsal } = await rehearsalsRepo.saveRehearsal(user.id, id, value);
    revalidatePrograms(programId);
    return { rehearsal };
  });
}

/** Le moteur Sans IA n'a pas de prompt : contexte inutilisé. */
const NO_PROMPT_CONTEXT: JuryPromptContext = { problem: "", language: "fr" };

/** Problématique et langue du diaporama, pour le prompt IA (lecture ouverte au lecteur ; le service exige l'éditeur). */
async function promptContext(userId: string, deckId: string): Promise<JuryPromptContext> {
  const deck = await decksRepo.getDeck(userId, deckId);
  return { problem: deck.problem ?? deck.spec.subtitle, language: deck.program.template.language };
}

/**
 * Facture le générateur au moment de l'appel — donc APRÈS la vérification du
 * droit d'éditeur, faite par le service avant de générer : Sans IA, quota
 * anti-abus du moteur gratuit ; IA, quota de la facturation du rédacteur,
 * restitué si l'échec prouve que rien n'a été calculé.
 */
function billed(userId: string, resolved: ResolvedEngine, generator: JuryQuestionsGenerator): JuryQuestionsGenerator {
  return {
    engine: generator.engine,
    async generate(input) {
      if (resolved.engine === "free") {
        await consumeFreeEngineQuota(userId);
        return generator.generate(input);
      }
      await consumeAiQuotaFor(resolved.billing, userId, 1);
      try {
        return await generator.generate(input);
      } catch (error) {
        if (isRefundableAiError(error)) await refundAiQuotaFor(resolved.billing, userId, 1);
        throw error;
      }
    },
  };
}

/**
 * Prépare (ou remplace) les questions du jury d'un diaporama (éditeur), avec le
 * rédacteur de l'utilisateur : son IA, ou la version sans IA s'il a choisi Sans
 * IA. Un rédacteur inutilisable ou une erreur IA s'affichent tels quels : jamais
 * de bascule silencieuse vers la version sans IA.
 */
export async function generateJuryQuestions(
  deckId: string,
): Promise<ActionResult<{ questions: QuestionView[]; engine: DeckEngine }>> {
  return runAction("generateJuryQuestions", async ({ user, log }) => {
    const id = parseInput(IdSchema, deckId);
    const resolved = await getEngineForUser(user.id, { log });
    const context = resolved.engine === "free" ? NO_PROMPT_CONTEXT : await promptContext(user.id, id);
    const generator = billed(user.id, resolved, juryQuestions.juryQuestionsGeneratorFor(resolved, context));
    const { programId, questions, engine } = await juryQuestions.generateJuryQuestions(user.id, id, { generator });
    revalidatePrograms(programId);
    return { questions, engine };
  });
}

/** « Je sais répondre » / « À revoir » pour l'utilisateur connecté (lecteur et plus). */
export async function setQuestionReview(
  questionId: string,
  status: ReviewStatus,
): Promise<ActionResult<{ status: ReviewStatus }>> {
  return runAction("setQuestionReview", async ({ user }) => {
    const id = parseInput(IdSchema, questionId);
    const value = parseInput(ReviewStatusSchema, status);
    await consumePracticeQuota(`review:${user.id}`, REVIEW_QUOTA);
    const result = await questionsRepo.setReview(user.id, id, value);
    revalidatePath(questionsPath(result.programId, result.deckId));
    return { status: result.status };
  });
}
