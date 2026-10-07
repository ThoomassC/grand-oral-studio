import type { Instrumentation } from "next";

/**
 * Observabilité : toute erreur serveur capturée par Next (rendu, Route Handler,
 * Server Action, proxy) est journalisée en une ligne JSON avec son `digest`,
 * la référence affichée à l'utilisateur par error.tsx / global-error.tsx.
 *
 * Jamais la chaîne de requête (le lien de réinitialisation y porte un jeton)
 * ni les en-têtes (cookies de session).
 */

type RequestInfo = Parameters<Instrumentation.onRequestError>[1];
type ErrorContext = Parameters<Instrumentation.onRequestError>[2];

export function requestErrorFields(error: unknown, request: RequestInfo, context: ErrorContext) {
  const digest =
    typeof error === "object" && error !== null && "digest" in error && error.digest !== undefined
      ? String(error.digest)
      : undefined;
  return {
    digest,
    path: request.path.split("?")[0],
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
