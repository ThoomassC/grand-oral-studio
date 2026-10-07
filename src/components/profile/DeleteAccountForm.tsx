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
 */
export function DeleteAccountForm({
  email,
  action,
}: {
  email: string;
  action: (input: DeleteAccountInput) => Promise<ActionResult<null>>;
}) {
  const router = useRouter();
  return (
    <ConfirmAction
      triggerLabel="Supprimer mon compte"
      title="Supprimer votre compte ?"
      question="Votre compte, vos projets, leurs sujets et leurs diaporamas, ainsi que vos réglages IA seront supprimés. Cette action est définitive."
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
