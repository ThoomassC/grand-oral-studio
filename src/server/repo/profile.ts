import { db } from "../db/client";
import type { ProfileView, SignInMethod } from "./types";

/** Fournisseurs Better Auth → méthode affichée. Tout autre fournisseur est ignoré. */
const METHOD: Record<string, SignInMethod> = { credential: "password", google: "google" };
const ORDER: SignInMethod[] = ["password", "google"];

/**
 * Profil de l'utilisateur `userId`, en DTO explicite : aucun mot de passe,
 * jeton ni identifiant de compte OAuth n'est lu (sélection de colonnes), donc
 * aucun ne peut fuiter. Filtré par `userId` : on n'atteint que sa propre ligne.
 */
export async function getProfile(userId: string): Promise<ProfileView | null> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      createdAt: true,
      accounts: { select: { providerId: true } },
      // Projets possédés et actifs : ni les projets partagés, ni la corbeille.
      _count: { select: { programs: { where: { deletedAt: null } } } },
    },
  });
  if (!user) return null;
  const methods = new Set(user.accounts.map((a) => METHOD[a.providerId]).filter((m): m is SignInMethod => m !== undefined));
  return {
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    signInMethods: ORDER.filter((m) => methods.has(m)),
    projectCount: user._count.programs,
  };
}
