import { deckToPptx } from "@/export/pptx";
import { isAppError } from "@/server/errors";
import { attachmentHeader, deckFileTitle, safeFilename, unicodeFilename } from "@/server/filename";
import { createLogger } from "@/server/logger";
import { getDeck } from "@/server/queries";
import { getUser } from "@/server/session";
import { IdSchema } from "@/server/validation";

/**
 * GET /api/decks/:id/pptx — export PowerPoint d'un deck d'un projet auquel
 * l'utilisateur a accès (lecteur au moins : l'export est ouvert au lecteur).
 * 401 sans session, 404 si le deck n'existe pas, est à la corbeille OU relève
 * d'un projet inaccessible (indistinguables), 500 générique sur panne (journalisée).
 */

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function jsonError(status: number, error: string, correlationId: string): Response {
  return Response.json(
    { error, ref: correlationId },
    { status, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } },
  );
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const log = createLogger({ route: "GET /api/decks/[id]/pptx" });
  const user = await getUser();
  if (!user) return jsonError(401, "Vous devez être connecté.", log.correlationId);

  const parsedId = IdSchema.safeParse((await ctx.params).id);
  if (!parsedId.success) return jsonError(404, "Ce deck est introuvable.", log.correlationId);

  try {
    const deck = await getDeck(user.id, parsedId.data);
    const buffer = await deckToPptx(deck.spec, deck.program.brand, deck.program.template);
    // Même règle pour tous les moteurs (le titre du deck, lui, varie d'un moteur à l'autre).
    const title = deckFileTitle({ themeName: deck.themeName, kind: deck.kind, engine: deck.engine, createdAt: deck.createdAt });
    log.info("deck.exported", { userId: user.id, deckId: deck.id, bytes: buffer.byteLength });
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": PPTX_MIME,
        "Content-Disposition": attachmentHeader(safeFilename(title, "pptx"), unicodeFilename(title, "pptx")),
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Correlation-Id": log.correlationId,
      },
    });
  } catch (error) {
    if (isAppError(error)) return jsonError(error.status, error.userMessage, log.correlationId);
    log.error("deck.export_failed", { userId: user.id, deckId: parsedId.data, error });
    return jsonError(500, "L'export a échoué. Réessayez dans un instant.", log.correlationId);
  }
}
