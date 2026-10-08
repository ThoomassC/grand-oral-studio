import type { Instrumentation } from "next";

/**
 * Observabilité : toute erreur serveur capturée par Next (rendu, Route Handler,
 * Server Action, proxy) est journalisée en une ligne JSON avec son `digest`,
 * la référence affichée à l'utilisateur par error.tsx / global-error.tsx.
 *
 * Jamais la chaîne de requête ni le fragment (le lien de réinitialisation y
 * porte un jeton), ni ce qui suit /reset-password/ ou /verify-email/ dans le
 * chemin (Better Auth y place le jeton : /api/auth/reset-password/:token), ni
 * les en-têtes (cookies de session).
 */

type RequestInfo = Parameters<Instrumentation.onRequestError>[1];
type ErrorContext = Parameters<Instrumentation.onRequestError>[2];

/** Segments porteurs de jeton : tout ce qui suit est masqué (séparateur encodé compris). */
const TOKEN_SEGMENT = /(\/(?:reset-password|verify-email))[/;%].*$/i;

/** Chemin journalisable : sans requête, sans fragment, jetons de chemin masqués. */
export function loggablePath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(TOKEN_SEGMENT, "$1/[masqué]");
}

export function requestErrorFields(error: unknown, request: RequestInfo, context: ErrorContext) {
  const digest =
    typeof error === "object" && error !== null && "digest" in error && error.digest !== undefined
      ? String(error.digest)
      : undefined;
  return {
    digest,
    path: loggablePath(request.path),
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    error: error instanceof Error ? error : String(error),
  };
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Le journal utilise node:crypto : runtime Node seulement (le proxy de Next 16 y tourne aussi).
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    console.error(JSON.stringify({ level: "error", event: "request.error", ...requestErrorFields(error, request, context), error: undefined }));
    return;
  }
  const { createLogger } = await import("./server/logger");
  createLogger({ scope: "next" }).error("request.error", requestErrorFields(error, request, context));
};
