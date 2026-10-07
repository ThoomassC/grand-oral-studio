"use client";

import { useRouter } from "next/navigation";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import type { ActionResult } from "@/server/actions/result";
import type { DeleteAccountInput } from "./schema";

/**
 * Supprimer son compte : confirmation dans une modale en recopiant l'adresse
 * e-mail du compte (comme la suppression d'un projet recopie son nom). Le
 * serveur revérifie l'adresse contre la session. Après succès, retour à
 * l'accueil (comme la déconnexion) : la session n'existe plus.
 * `sharesProjects` : l'utilisateur possède des projets partagés, que ses
 * collègues perdront aussi (suppression en cascade).
 */
export const SHARED_PROJECTS_WARNING = "Les projets que vous partagez seront supprimés pour vos collègues aussi.";

export function DeleteAccountForm({
  email,
  action,
  sharesProjects = false,
}: {
  email: string;
  action: (input: DeleteAccountInput) => Promise<ActionResult<null>>;
  sharesProjects?: boolean;
}) {
  const router = useRouter();
  return (
    <ConfirmAction
      triggerLabel="Supprimer mon compte"
      title="Supprimer votre compte ?"
      question={`Votre compte, vos projets, leurs sujets et leurs diaporamas, ainsi que vos réglages IA seront supprimés.${
        sharesProjects ? ` ${SHARED_PROJECTS_WARNING}` : ""
      } Cette action est définitive.`}
      confirmLabel="Supprimer définitivement"
      size="medium"
      requireText={email}
      onConfirm={async () => {
        const result = await action({ confirmEmail: email });
        return result.ok ? null : result.error;
      }}
      onDone={() => {
        router.push("/");
        router.refresh();
      }}
    />
  );
}
