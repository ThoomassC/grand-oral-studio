import { isAppError, RateLimitedError } from "@/server/errors";
import { attachmentHeader, safeFilename, unicodeFilename } from "@/server/filename";
import { createLogger } from "@/server/logger";
import { exportProject } from "@/server/services/project-transfer";
import { getUser } from "@/server/session";
import { IdSchema } from "@/server/validation";

/**
 * GET /api/projets/:id/export — fichier JSON d'export d'un projet auquel
 * l'utilisateur a accès (lecteur au moins). 401 sans session, 404 si le projet
 * n'existe pas, est à la corbeille OU est inaccessible (indistinguables), 413 si le
 * fichier dépasserait 4 Mo (il ne pourrait pas être réimporté), 429 au-delà du quota
 * d'exports, 500 générique sur panne (journalisée). JSON compact ; une donnée abîmée
 * en base dégrade l'export (apparence par défaut, diaporama écarté et compté) sans l'empêcher. Aucun identifiant
 * interne, membre ni secret dans le fichier (cf. src/domain/project-export.ts).
 */

function jsonError(status: number, error: string, correlationId: string, extra: Record<string, string> = {}): Response {
  return Response.json(
    { error, ref: correlationId },
    { status, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId, ...extra } },
  );
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const log = createLogger({ route: "GET /api/projets/[id]/export" });
  const user = await getUser();
  if (!user) return jsonError(401, "Vous devez être connecté.", log.correlationId);

  const parsedId = IdSchema.safeParse((await ctx.params).id);
  if (!parsedId.success) return jsonError(404, "Ce projet est introuvable.", log.correlationId);

  const scoped = log.child({ userId: user.id, programId: parsedId.data });
  try {
    const { body, title } = await exportProject(user.id, parsedId.data, { log: scoped });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": attachmentHeader(safeFilename(title, "json", "projet"), unicodeFilename(title, "json", "projet")),
        "Content-Length": String(Buffer.byteLength(body, "utf8")),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Correlation-Id": log.correlationId,
      },
    });
  } catch (error) {
    if (error instanceof RateLimitedError) {
      const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
      return jsonError(429, `Trop d'exports en peu de temps. Réessayez dans ${minutes} min.`, log.correlationId, {
        "Retry-After": String(Math.ceil(error.retryAfterSeconds)),
      });
    }
    if (isAppError(error)) return jsonError(error.status, error.userMessage, log.correlationId);
    scoped.error("project.export_failed", { error });
    return jsonError(500, "L'export a échoué. Réessayez dans un instant.", log.correlationId);
  }
}
