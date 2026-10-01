import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";

/**
 * Session côté serveur (Server Components, Server Actions, Route Handlers).
 * La session est vérifiée en base par Better Auth à chaque requête (pas de
 * simple lecture du cookie) ; `cache` dédoublonne les appels d'un même rendu.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export const LOGIN_PATH = "/connexion";

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
});

/** Utilisateur connecté, sinon redirection vers /connexion (lève NEXT_REDIRECT). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}
