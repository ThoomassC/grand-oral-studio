import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Filet de sécurité optimiste (Next 16 : `proxy` remplace `middleware`) : sans
 * cookie de session, /projets/** et /configuration-ia redirigent vers /connexion. Ce n'est PAS
 * l'autorisation : la présence d'un cookie ne prouve rien. Chaque page appelle
 * requireUser() et chaque action/route revérifie la session et la propriété
 * de la ressource.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = new URL("/connexion", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  // Chemin relatif interne uniquement (pas de redirection ouverte).
  if (next.startsWith("/") && !next.startsWith("//")) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/projets", "/projets/:path*", "/configuration-ia", "/profil"],
};
