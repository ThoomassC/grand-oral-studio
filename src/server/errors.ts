/**
 * Erreurs serveur typées.
 *
 * - `AppError` et ses sous-classes sont des erreurs ATTENDUES (règle métier,
 *   ressource absente, quota) : leur `userMessage` (français) peut être montré tel
 *   quel au client, avec le `status` HTTP correspondant.
 * - Toute autre exception est une PANNE : journalisée avec contexte, jamais
 *   renvoyée brute au client.
 */

import { PROVIDER_INFO, type CloudProvider } from "@/domain/ai-providers";

export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | "AI_REFUSAL"
  | "AI_INVALID_OUTPUT"
  | "AI_UNAVAILABLE"
  | "AI_KEY_REQUIRED"
  | "AI_KEY_REJECTED"
  | "AI_KEY_UNREADABLE"
  | "AI_CREDIT_EXHAUSTED"
  | "AI_RATE_LIMITED"
  | "ENGINE_UNAVAILABLE"
  | "CONFIGURATION"
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
const RESOURCE_LABELS = { programme: "projet", thème: "sujet", deck: "deck" } as const;

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
  constructor(resource: "programme" | "thème" | "deck" = "programme") {
    // Clés internes « programme » et « thème » ; l'interface parle de « projet » et de « sujet ».
    super(`Ce ${RESOURCE_LABELS[resource]} est introuvable.`);
  }
}

/**
 * L'appelant voit le projet (il en est membre) mais son rôle ne permet pas
 * l'action (ex. un lecteur qui modifie l'apparence). Jamais levée pour un
 * inconnu : celui-ci reçoit NotFoundError, l'existence du projet n'est pas révélée.
 */
export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN" as const;
  readonly status = 403;
  constructor() {
    super("Vous n'avez pas les droits pour cette action sur ce projet.");
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

/** L'état de la ressource a changé entre-temps (ex. liste de sujets périmée). */
export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly status = 409;
}

/** Plafond métier atteint (nombre de sujets, taille d'import…). */
export class LimitExceededError extends AppError {
  readonly code = "LIMIT_EXCEEDED" as const;
  readonly status = 422;
}

export class RateLimitedError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;
  constructor(
    readonly retryAfterSeconds: number,
    /**
     * "user" : quota de l'utilisateur ; "global" : plafond de coût de toute
     * l'application ; "verify" : vérifications de clé API ; "import" : imports
     * de charte ou de gabarit.
     */
    readonly scope: "user" | "global" | "verify" | "import" = "user",
  ) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      scope === "global"
        ? `Le service de génération est très sollicité en ce moment. Réessayez dans ${minutes} min.`
        : scope === "verify"
          ? `Trop de vérifications de clé en peu de temps. Réessayez dans ${minutes} min.`
          : scope === "import"
            ? `Trop d'imports en peu de temps. Réessayez dans ${minutes} min.`
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
      "L'IA a refusé de traiter cette demande. Reformulez la problématique ou le sujet, puis réessayez.",
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
  /**
   * Rien n'a été calculé (connexion refusée, file d'attente pleine) : l'unité de
   * quota consommée peut être restituée.
   */
  readonly refundable: boolean;
  constructor(
    readonly detail: string,
    options?: { cause?: unknown; userMessage?: string; refundable?: boolean },
  ) {
    super(
      options?.userMessage ?? "Le service de génération est momentanément indisponible. Réessayez dans un instant.",
      options,
    );
    this.refundable = options?.refundable ?? false;
  }
}

/** Hôte de la console d'un fournisseur (« console.anthropic.com »), pour les messages. */
function consoleHost(provider: CloudProvider): string {
  return new URL(PROVIDER_INFO[provider].consoleUrl).host;
}

/** Aucune clé API utilisable pour le fournisseur choisi (ni personnelle, ni d'équipe selon le choix) hors mode simulé. */
export class AiKeyRequiredError extends AppError {
  readonly code = "AI_KEY_REQUIRED" as const;
  readonly status = 422;
  readonly provider: CloudProvider;
  constructor(provider: CloudProvider = "claude") {
    super(`Ajoutez votre clé API ${PROVIDER_INFO[provider].apiName} dans la Configuration IA pour lancer une génération.`);
    this.provider = provider;
  }
}

/** La clé API de l'UTILISATEUR est refusée par le fournisseur (401/403). */
export class AiKeyRejectedError extends AppError {
  readonly code = "AI_KEY_REJECTED" as const;
  readonly status = 422;
  readonly provider: CloudProvider;
  constructor(options?: { cause?: unknown; provider?: CloudProvider }) {
    const provider = options?.provider ?? "claude";
    super(`Votre clé API ${PROVIDER_INFO[provider].apiName} est refusée. Mettez-la à jour dans la Configuration IA.`, options);
    this.provider = provider;
  }
}

/** Le compte de l'UTILISATEUR chez le fournisseur n'a plus de crédit (Anthropic « credit balance », 402, insufficient_quota). */
export class AiCreditExhaustedError extends AppError {
  readonly code = "AI_CREDIT_EXHAUSTED" as const;
  readonly status = 422;
  readonly provider: CloudProvider;
  constructor(options?: { cause?: unknown; provider?: CloudProvider }) {
    const provider = options?.provider ?? "claude";
    super(
      `Votre compte ${PROVIDER_INFO[provider].apiName} n'a plus de crédit. Rechargez-le sur ${consoleHost(provider)} ou choisissez le moteur gratuit dans la Configuration IA.`,
      options,
    );
    this.provider = provider;
  }
}

/** Durée lisible : « 30 s », « 2 min ». */
function waitLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

/**
 * Le FOURNISSEUR limite le débit (HTTP 429) : rien n'a été produit, l'unité de
 * quota interne consommée est restituée (cf. isRefundableAiError). Aucune
 * nouvelle tentative automatique ni bascule vers un autre fournisseur.
 */
export class AiProviderRateLimitedError extends AppError {
  readonly code = "AI_RATE_LIMITED" as const;
  readonly status = 429;
  readonly refundable = true;
  constructor(
    readonly provider: CloudProvider,
    readonly retryAfterSeconds: number,
    options?: { cause?: unknown },
  ) {
    super(
      `${PROVIDER_INFO[provider].label} limite le nombre de requêtes en ce moment. Réessayez dans ${waitLabel(retryAfterSeconds)}, ou choisissez un autre rédacteur.`,
      options,
    );
  }
}

/** L'échec d'un appel IA n'a rien coûté : l'unité de quota interne peut être restituée. */
export function isRefundableAiError(error: unknown): boolean {
  return (error instanceof AiUnavailableError && error.refundable) || error instanceof AiProviderRateLimitedError;
}

/**
 * Le moteur de rédaction choisi par l'utilisateur n'est pas utilisable (Ollama
 * non configuré, modèle non choisi…). Jamais de bascule silencieuse : le message
 * renvoie vers la Configuration IA.
 */
export class EngineUnavailableError extends AppError {
  readonly code = "ENGINE_UNAVAILABLE" as const;
  readonly status = 422;
}

/**
 * La clé enregistrée existe mais ne se déchiffre pas (clé maître absente,
 * changée sans rotation, ou valeur altérée). On ne bascule PAS silencieusement
 * sur la clé serveur : l'utilisateur doit savoir que sa clé n'est pas utilisée.
 */
export class AiKeyUnreadableError extends AppError {
  readonly code = "AI_KEY_UNREADABLE" as const;
  readonly status = 503;
  constructor(options?: { cause?: unknown }) {
    super("Votre clé API enregistrée ne peut pas être lue. Enregistrez-la à nouveau dans la Configuration IA.", options);
  }
}

/** Configuration serveur manquante pour une fonctionnalité (ex. clé maître de chiffrement). */
export class ConfigurationError extends AppError {
  readonly code = "CONFIGURATION" as const;
  readonly status = 503;
  constructor(
    userMessage: string,
    /** Détail destiné au journal (jamais de secret). */
    readonly detail: string,
  ) {
    super(userMessage);
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
