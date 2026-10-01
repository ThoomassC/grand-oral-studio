import type { ClassificationOutcome, ProgramContext } from "@/domain/contracts";
import { normalizeClassification } from "@/domain/classification";
import { classifyProblemFree } from "@/domain/free";
import type { Classification } from "@/domain/schemas";
import { AiInvalidOutputError, AiRefusalError, isAppError, type AppError } from "../errors";
import type { Logger } from "../logger";

/**
 * Reconnaissance du thème avec repli : si la tentative IA échoue (indisponible,
 * refus, sortie invalide, clé refusée, quota… — toute AppError), la reconnaissance sans IA
 * (`classifyProblemFree`, pure et instantanée) prend le relais — le jour J,
 * l'élève a toujours une réponse. Fonction sans base ni réseau (l'appel IA est
 * injecté), testable seule.
 */

export const FALLBACK_REASON_DEFAULT = "Le service IA n'a pas répondu.";

function fallbackReason(error: AppError): string {
  if (error instanceof AiRefusalError) return "L'IA a refusé de traiter la demande.";
  if (error instanceof AiInvalidOutputError) return "L'IA a renvoyé une réponse inexploitable.";
  // Indisponibilité (messages Ollama utiles), clé refusée, crédit épuisé, quota… : le message dit quoi faire.
  return error.userMessage || FALLBACK_REASON_DEFAULT;
}

export async function classifyWithFallback(
  ctx: ProgramContext,
  input: { problem: string; hintedThemeId?: string | null },
  attempt: (() => Promise<Classification>) | null,
  log: Logger,
): Promise<ClassificationOutcome> {
  const free = (reason: string | null): ClassificationOutcome => ({
    ...classifyProblemFree(ctx, input.problem, input.hintedThemeId),
    source: "free",
    fallbackReason: reason,
  });
  if (!attempt) return free(null);

  try {
    const raw = await attempt();
    // Filtre les ids inventés ou étrangers au programme, borne et trie.
    const result = normalizeClassification(raw, ctx.themes, input.hintedThemeId);
    if (result.ranked.length === 0) throw new AiInvalidOutputError("classify: aucun thème reconnu du programme");
    return { ...result, source: "ai", fallbackReason: null };
  } catch (error) {
    // Un bug de code ou une panne de base n'est pas une défaillance de l'IA : pas de maquillage en repli.
    if (!isAppError(error)) throw error;
    log.warn("classify.fallback_free", { errorCode: error.code });
    return free(fallbackReason(error));
  }
}
