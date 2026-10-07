import { unstable_rethrow } from "next/navigation";
import { AiProviderRateLimitedError, isAppError, RateLimitedError, ValidationError } from "../errors";
import { createLogger, type Logger } from "../logger";
import { requireUser, type SessionUser } from "../session";
import type { ActionResult } from "./result";

/**
 * Enveloppe commune des Server Actions : session obligatoire, journalisation
 * corrélée, traduction des erreurs.
 *  - AppError (attendue)  → { ok: false, error: message FR, code?, fieldErrors? }
 *    (`code` seulement si l'action le demande : `exposeCode` ; `retryAfterSeconds`
 *    toujours pour un quota ou une limite du fournisseur d'IA)
 *  - redirect/notFound Next → relancées telles quelles (unstable_rethrow)
 *  - toute autre erreur (panne) → journalisée avec contexte, message générique
 *    portant la référence de corrélation, jamais le message brut.
 */

export interface ActionContext {
  user: SessionUser;
  log: Logger;
}

export interface RunOptions {
  /** Renvoie aussi le code de l'erreur attendue (AppErrorCode), pour une interface qui en dépend. */
  exposeCode?: boolean;
}

export async function runAction<T>(
  name: string,
  fn: (ctx: ActionContext) => Promise<T>,
  options: RunOptions = {},
): Promise<ActionResult<T>> {
  const log = createLogger({ action: name });
  const started = Date.now();
  try {
    const user = await requireUser();
    const scoped = log.child({ userId: user.id });
    const data = await fn({ user, log: scoped });
    scoped.info("action.ok", { durationMs: Date.now() - started });
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error)) {
      log.info("action.rejected", { code: error.code, durationMs: Date.now() - started });
      return {
        ok: false,
        error: error.userMessage,
        ...(options.exposeCode ? { code: error.code } : {}),
        ...(error instanceof ValidationError && error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        ...retryAfterOf(error),
      };
    }
    log.error("action.failed", { error, durationMs: Date.now() - started });
    return {
      ok: false,
      error: `Une erreur inattendue est survenue. Réessayez ; si le problème persiste, communiquez la référence ${log.correlationId}.`,
    };
  }
}

/** Attente à annoncer (secondes, > 0) d'un quota ou d'une limite du fournisseur d'IA ; rien sinon. */
function retryAfterOf(error: unknown): { retryAfterSeconds?: number } {
  if (!(error instanceof RateLimitedError || error instanceof AiProviderRateLimitedError)) return {};
  const seconds = error.retryAfterSeconds;
  return Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.ceil(seconds) } : {};
}
