import { enforceProblem } from "@/domain/deck-quality";
import type { Slide } from "@/domain/schemas";
import { buildSlidePrompt } from "@/domain/task-prompts";
import type { AiProvider } from "../ai";
import { ConflictError, isRefundableAiError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeAiQuotaFor, refundAiQuotaFor, type AiBilling } from "../rate-limit";
import { DECK_CHANGED_MESSAGE, getSlideEditContext, updateDeckSlide, type DeckEditResult, type SlideEditContext } from "../repo/decks";
import { singleFlight } from "../single-flight";

/**
 * Réécriture d'UNE diapo par l'IA du rédacteur de l'utilisateur.
 *
 * Ordre des opérations (aucun appel lent dans une transaction) :
 *  1. lecture du deck, de sa trame et de son sujet, droit d'éditeur (404 / 403) ;
 *  2. contrôle de version et d'index AVANT de consommer le quota : un onglet
 *     périmé ne paie pas un appel dont le résultat serait refusé ;
 *  3. quota IA de la facturation du rédacteur, puis appel IA HORS transaction
 *     (unité restituée si l'échec prouve que rien n'a été calculé) ;
 *  4. écriture sous verrou (`updateDeckSlide`), droit et version revérifiés :
 *     une modification faite ailleurs pendant l'appel n'est pas écrasée.
 *
 * La diapo garde sa mise en page et sa ligne de trame : l'IA réécrit le
 * contenu, pas la structure. La problématique tirée est réécrite par le code
 * (couverture, diapo de la ligne « problématique »), comme au jour J.
 *
 * Rejouable : deux demandes simultanées sur la même diapo et la même version
 * n'en font qu'une (singleFlight, par instance) ; la seconde écriture serait de
 * toute façon refusée par le contrôle de version.
 */

export interface SlideRegenerationDeps {
  ai: AiProvider;
  billing: AiBilling;
  log: Logger;
}

export async function regenerateSlide(
  userId: string,
  deckId: string,
  index: number,
  expectedUpdatedAt: string,
  deps: SlideRegenerationDeps,
): Promise<DeckEditResult> {
  const version = new Date(expectedUpdatedAt).getTime();
  return singleFlight(`slide:${userId}:${deckId}:${index}:${version}`, () =>
    regenerateSlideOnce(userId, deckId, index, expectedUpdatedAt, deps),
  );
}

async function regenerateSlideOnce(
  userId: string,
  deckId: string,
  index: number,
  expectedUpdatedAt: string,
  deps: SlideRegenerationDeps,
): Promise<DeckEditResult> {
  const ctx = await getSlideEditContext(userId, deckId);
  if (new Date(ctx.updatedAt).getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new ConflictError(DECK_CHANGED_MESSAGE);
  }
  const current = ctx.spec.slides[index];
  if (!current) throw new ValidationError("Cette diapo n'existe plus : rechargez le diaporama.");

  await consumeAiQuotaFor(deps.billing, userId, 1);
  let written: Slide;
  try {
    written = await deps.ai.generateStructured({
      task: "slide",
      prompt: buildSlidePrompt({ deck: ctx.spec, index, template: ctx.template, subject: ctx.subject, problem: ctx.problem }),
      hints: { current },
    });
  } catch (error) {
    if (isRefundableAiError(error)) {
      // Un échec du remboursement est journalisé : il ne masque jamais l'erreur d'origine.
      try {
        await refundAiQuotaFor(deps.billing, userId, 1);
        deps.log.info("ai.quota_refunded", { task: "slide" });
      } catch (refundError) {
        deps.log.error("ai.quota_refund_failed", { task: "slide", error: refundError });
      }
    }
    throw error;
  }

  const rewritten: Slide = { ...written, layout: current.layout, sectionId: current.sectionId };
  return updateDeckSlide(userId, deckId, index, withProblem(ctx, index, rewritten), expectedUpdatedAt);
}

/**
 * Diapo réécrite, problématique réimposée (sous-titre de la couverture, diapo
 * de la ligne « problématique ») si le deck en a une. Le nom du projet n'est
 * pas lu ici : le titre d'une couverture n'est remplacé que s'il est vide.
 */
function withProblem(ctx: SlideEditContext, index: number, slide: Slide): Slide {
  if (!ctx.problem.trim()) return slide;
  const deck = { ...ctx.spec, slides: ctx.spec.slides.map((s, i) => (i === index ? slide : s)) };
  const enforced = enforceProblem(deck, {
    template: ctx.template,
    problem: ctx.problem,
    themeName: ctx.subject?.name ?? null,
    programName: "",
  });
  return enforced.slides[index] ?? slide;
}
