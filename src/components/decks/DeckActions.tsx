"use client";

import { useRouter } from "next/navigation";
import { deleteDeck } from "@/server/actions/decks";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";

export function DeleteDeckButton({
  deckId,
  label,
  redirectTo,
  focusAfterDelete = [],
}: {
  deckId: string;
  label: string;
  /** Page où aller après suppression (sinon on reste et la liste se met à jour). */
  redirectTo?: string;
  /** Ids à focaliser après suppression (liste), par ordre de préférence. */
  focusAfterDelete?: string[];
}) {
  const router = useRouter();
  return (
    <ConfirmAction
      triggerLabel="Supprimer"
      triggerAccessibleLabel={`Supprimer le deck ${label}`}
      question={`Supprimer le deck « ${label} » ? Cette action est définitive.`}
      confirmLabel="Supprimer le deck"
      onConfirm={async () => {
        const result = await deleteDeck(deckId);
        if (!result.ok) return result.error;
        if (redirectTo) router.replace(redirectTo);
        return null;
      }}
      onDone={() => {
        if (!redirectTo) focusLater(focusAfterDelete);
      }}
    />
  );
}
