"use server";

import { isAPIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  confirmsAccountEmail,
  DeleteAccountSchema,
  ProfileNameSchema,
  type DeleteAccountInput,
  type ProfileNameInput,
} from "@/components/profile/schema";
import { auth } from "@/lib/auth";
import type { ActionResult } from "@/server/actions/result";
import { runAction } from "@/server/actions/run";
import { ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";

/**
 * Modifier le nom du compte connecté.
 *
 * Server Action plutôt que `authClient.updateUser` côté client : l'endpoint
 * Better Auth accepte n'importe quelle valeur pour `name` (schéma `z.any`),
 * on valide donc ici avec le même schéma que le formulaire (2 à 80
 * caractères), puis on passe par l'API serveur de Better Auth, qui n'écrit
 * que la ligne de l'utilisateur de la session et rafraîchit son cookie
 * (plugin nextCookies). `runAction` exige la session et traduit les erreurs.
 */
export async function updateProfileName(input: ProfileNameInput): Promise<ActionResult<{ name: string }>> {
  return runAction("updateProfileName", async () => {
    const { name } = parseInput(ProfileNameSchema, input);
    await auth.api.updateUser({ body: { name }, headers: await headers() });
    revalidatePath("/", "layout");
    return { name };
  });
}

/**
 * Supprimer le compte connecté et toutes ses données (projets, sujets,
 * diaporamas, réglages IA : suppression en cascade depuis la ligne user).
 *
 * `/delete-user` est fermé en HTTP (DISABLED_AUTH_PATHS) : seule cette action
 * l'appelle, après avoir vérifié que l'adresse recopiée est celle du compte de
 * la SESSION (jamais un identifiant venu du client). Better Auth exige en plus
 * une session récente (moins de 24 h) : sinon SESSION_EXPIRED, et on demande
 * de se reconnecter. Le cookie de session est effacé par nextCookies.
 */
export async function deleteAccount(input: DeleteAccountInput): Promise<ActionResult<null>> {
  return runAction("deleteAccount", async ({ user }) => {
    const { confirmEmail } = parseInput(DeleteAccountSchema, input);
    if (!confirmsAccountEmail(confirmEmail, user.email)) {
      throw new ValidationError("L'adresse recopiée ne correspond pas à celle du compte.", {
        confirmEmail: ["Recopiez exactement l'adresse e-mail du compte."],
      });
    }
    try {
      await auth.api.deleteUser({ body: {}, headers: await headers() });
    } catch (error) {
      if (isAPIError(error) && error.body?.code === "SESSION_EXPIRED") {
        throw new ValidationError(
          "Par sécurité, la suppression demande une connexion récente. Déconnectez-vous, reconnectez-vous, puis recommencez.",
        );
      }
      throw error;
    }
    return null;
  });
}
