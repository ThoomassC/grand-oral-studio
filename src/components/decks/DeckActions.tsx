"use client";

import { useRouter } from "next/navigation";
import { deleteDeck } from "@/server/actions/decks";
import { ConfirmAction } from "@/components/ui/ConfirmAction";

export function DeleteDeckButton({
  deckId,
  label,
  redirectTo,
}: {
  deckId: string;
  label: string;
  /** Page où aller après suppression (sinon on reste et la liste se met à jour). */
  redirectTo?: string;
}) {
  const router = useRouter();
  return (
    <ConfirmAction
      triggerLabel="Supprimer"
      triggerAccessibleLabel={`Supprimer le deck ${label}`}
      question={`Supprimer le deck « ${label} » ? Cette action est définitive.`}
      confirmLabel="Supprimer"
      onConfirm={async () => {
        const result = await deleteDeck(deckId);
        if (!result.ok) return result.error;
        if (redirectTo) router.replace(redirectTo);
        return null;
      }}
    />
  );
}
