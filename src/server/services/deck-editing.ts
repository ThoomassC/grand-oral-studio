import type { Slide } from "@/domain/schemas";
import { buildSlidePrompt } from "@/domain/task-prompts";
import type { AiProvider } from "../ai";
import { ConflictError, isRefundableAiError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeAiQuotaFor, refundAiQuotaFor, type AiBilling } from "../rate-limit";
import { DECK_CHANGED_MESSAGE, getSlideEditContext, updateDeckSlide, type DeckEditResult } from "../repo/decks";

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
 * contenu, pas la structure.
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
      await refundAiQuotaFor(deps.billing, userId, 1);
      deps.log.info("ai.quota_refunded", { task: "slide" });
    }
    throw error;
  }

  const slide: Slide = { ...written, layout: current.layout, sectionId: current.sectionId };
  return updateDeckSlide(userId, deckId, index, slide, expectedUpdatedAt);
}
