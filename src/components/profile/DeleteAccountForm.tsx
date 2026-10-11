"use client";

import { useRouter } from "next/navigation";
import { ConfirmAction, ConfirmActionDialog } from "@/components/ui/ConfirmAction";
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

interface DeleteAccountProps {
  email: string;
  action: (input: DeleteAccountInput) => Promise<ActionResult<null>>;
  sharesProjects?: boolean;
}

function useAccountDeletion({
  email,
  action,
  sharesProjects = false,
}: DeleteAccountProps) {
  const router = useRouter();
  return {
    title: "Supprimer votre compte ?",
    question: `Votre compte, vos projets, leurs sujets et leurs diaporamas, ainsi que vos réglages IA seront supprimés.${
      sharesProjects ? ` ${SHARED_PROJECTS_WARNING}` : ""
    } Cette action est définitive.`,
    confirmLabel: "Supprimer définitivement",
    requireText: email,
    onConfirm: async () => {
      const result = await action({ confirmEmail: email });
      return result.ok ? null : result.error;
    },
    onDone: () => {
      router.push("/");
      router.refresh();
    },
  };
}

export function DeleteAccountForm(props: DeleteAccountProps) {
  const confirmation = useAccountDeletion(props);
  return <ConfirmAction {...confirmation} triggerLabel="Supprimer mon compte" size="medium" />;
}

/** Même confirmation, ouverte directement depuis les paramètres du profil. */
export function DeleteAccountDialog({ open, onCancel, ...props }: DeleteAccountProps & { open: boolean; onCancel: () => void }) {
  const confirmation = useAccountDeletion(props);
  return (
    <ConfirmActionDialog
      {...confirmation}
      open={open}
      onCancel={onCancel}
      onDone={() => {
        onCancel();
        confirmation.onDone();
      }}
    />
  );
}
