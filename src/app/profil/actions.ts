"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ProfileNameSchema, type ProfileNameInput } from "@/components/profile/schema";
import { auth } from "@/lib/auth";
import type { ActionResult } from "@/server/actions/result";
import { runAction } from "@/server/actions/run";
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
