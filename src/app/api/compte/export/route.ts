import { isAppError, RateLimitedError } from "@/server/errors";
import { attachmentHeader, safeFilename } from "@/server/filename";
import { createLogger } from "@/server/logger";
import { exportAccount } from "@/server/services/project-transfer";
import { getUser } from "@/server/session";

/**
 * GET /api/compte/export — export des données du compte connecté (JSON) : profil,
 * réglages IA sans aucune clé, projets possédés, modèles publiés. Toujours le compte
 * de la session : aucun paramètre ne désigne un autre utilisateur. 401 sans session,
 * 429 au-delà de 5 exports par heure, 500 générique sur panne (journalisée).
 */

function jsonError(status: number, error: string, correlationId: string, extra: Record<string, string> = {}): Response {
  return Response.json(
    { error, ref: correlationId },
    { status, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId, ...extra } },
  );
}

/** « AAAA-MM-JJ » à Paris (les utilisateurs sont en France). */
function parisDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function GET(): Promise<Response> {
  const log = createLogger({ route: "GET /api/compte/export" });
  const user = await getUser();
  if (!user) return jsonError(401, "Vous devez être connecté.", log.correlationId);

  const scoped = log.child({ userId: user.id });
  try {
    const data = await exportAccount(user.id, { log: scoped });
    const body = JSON.stringify(data, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": attachmentHeader(safeFilename(`grand-oral-studio-compte-${parisDay(new Date())}`, "json", "compte")),
        "Content-Length": String(Buffer.byteLength(body, "utf8")),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Correlation-Id": log.correlationId,
      },
    });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
      return jsonError(429, `Trop d'exports du compte en peu de temps. Réessayez dans ${minutes} min.`, log.correlationId, {
        "Retry-After": String(Math.ceil(error.retryAfterSeconds)),
      });
    }
    if (isAppError(error)) return jsonError(error.status, error.userMessage, log.correlationId);
    scoped.error("account.export_failed", { error });
    return jsonError(500, "L'export du compte a échoué. Réessayez dans un instant.", log.correlationId);
  }
}
