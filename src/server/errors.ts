/**
 * Erreurs serveur typées.
 *
 * - `AppError` et ses sous-classes sont des erreurs ATTENDUES (règle métier,
 *   ressource absente, quota) : leur `userMessage` (français) peut être montré tel
 *   quel au client, avec le `status` HTTP correspondant.
 * - Toute autre exception est une PANNE : journalisée avec contexte, jamais
 *   renvoyée brute au client.
 */

export type AppErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | "AI_REFUSAL"
  | "AI_INVALID_OUTPUT"
  | "AI_UNAVAILABLE"
  | "UNAUTHENTICATED";

export abstract class AppError extends Error {
  abstract readonly code: AppErrorCode;
  abstract readonly status: number;

  constructor(
    /** Message destiné à l'utilisateur, en français. */
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = new.target.name;
  }
}

/**
 * Ressource absente OU appartenant à un autre utilisateur : on ne distingue pas
 * les deux cas pour ne pas révéler l'existence d'un objet.
 */
export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
  constructor(resource: "programme" | "thème" | "deck" = "programme") {
    super(`Ce ${resource} est introuvable.`);
  }
}

/** Entrée invalide au regard d'une règle métier (au-delà du schéma zod). */
export class ValidationError extends AppError {
  readonly code = "VALIDATION" as const;
  readonly status = 422;
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/** L'état de la ressource a changé entre-temps (ex. liste de thèmes périmée). */
export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly status = 409;
}

/** Plafond métier atteint (nombre de thèmes, taille d'import…). */
export class LimitExceededError extends AppError {
  readonly code = "LIMIT_EXCEEDED" as const;
  readonly status = 422;
}

export class RateLimitedError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;
  constructor(
    readonly retryAfterSeconds: number,
    /** "user" : quota de l'utilisateur ; "global" : plafond de coût de toute l'application. */
    readonly scope: "user" | "global" = "user",
  ) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      scope === "global"
        ? `Le service de génération est très sollicité en ce moment. Réessayez dans ${minutes} min.`
        : `Trop de générations en peu de temps. Réessayez dans ${minutes} min.`,
    );
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = "UNAUTHENTICATED" as const;
  readonly status = 401;
  constructor() {
    super("Vous devez être connecté.");
  }
}

/** Le modèle a refusé de répondre (stop_reason = "refusal"). */
export class AiRefusalError extends AppError {
  readonly code = "AI_REFUSAL" as const;
  readonly status = 422;
  constructor(readonly category: string | null) {
    super(
      "L'IA a refusé de traiter cette demande. Reformulez la problématique ou le thème, puis réessayez.",
    );
  }
}

/** Réponse du modèle absente, tronquée ou non conforme au schéma attendu. */
export class AiInvalidOutputError extends AppError {
  readonly code = "AI_INVALID_OUTPUT" as const;
  readonly status = 502;
  constructor(
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super("L'IA a renvoyé une réponse inexploitable. Réessayez dans un instant.", options);
  }
}

/** Fournisseur IA injoignable, en surcharge, ou mal configuré. */
export class AiUnavailableError extends AppError {
  readonly code = "AI_UNAVAILABLE" as const;
  readonly status = 503;
  constructor(
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super("Le service de génération est momentanément indisponible. Réessayez dans un instant.", options);
  }
}

/**
 * Donnée stockée en base qui ne respecte plus son schéma (JSON corrompu ou
 * migration manquante). C'est une PANNE, pas une erreur attendue.
 */
export class DataIntegrityError extends Error {
  constructor(
    readonly entity: string,
    readonly entityId: string,
    readonly issues: string,
  ) {
    super(`Donnée invalide en base : ${entity} ${entityId} (${issues})`);
    this.name = "DataIntegrityError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
