"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteDeck, duplicateDeck, restoreDeck } from "@/server/actions/decks";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { useUndoToast } from "./undo-toast";

/**
 * Suppression d'un deck. Un deck final part à la corbeille : une notification
 * propose « Annuler » pendant 10 s (restauration puis rafraîchissement). Un
 * ancien squelette (`undoable={false}`) est supprimé définitivement.
 */
export function DeleteDeckButton({
  deckId,
  label,
  redirectTo,
  focusAfterDelete = [],
  undoable = true,
}: {
  deckId: string;
  label: string;
  /** Page où aller après suppression (sinon on reste et la liste se met à jour). */
  redirectTo?: string;
  /** Ids à focaliser après suppression (liste), par ordre de préférence. */
  focusAfterDelete?: string[];
  /** false : ancien squelette, suppression définitive (aucune annulation). */
  undoable?: boolean;
}) {
  const router = useRouter();
  const showUndo = useUndoToast();
  return (
    <ConfirmAction
      triggerLabel="Supprimer"
      triggerAccessibleLabel={`Supprimer le diaporama ${label}`}
      title="Supprimer le diaporama ?"
      question={`Supprimer le diaporama « ${label} » ? ${undoable ? "Vous pourrez annuler pendant quelques secondes." : "Cette action est définitive."}`}
      confirmLabel="Supprimer le diaporama"
      onConfirm={async () => {
        const result = await deleteDeck(deckId);
        if (!result.ok) return result.error;
        if (result.data.undoUntil) {
          showUndo({
            id: `annuler-deck-${deckId}`,
            message: "Diaporama supprimé.",
            undoAccessibleLabel: `Annuler la suppression du diaporama ${label}`,
            restoredMessage: "Diaporama restauré.",
            onUndo: async () => {
              const restored = await restoreDeck(deckId);
              if (!restored.ok) return restored.error;
              router.refresh();
              return null;
            },
          });
        }
        if (redirectTo) router.replace(redirectTo);
        return null;
      }}
      onDone={() => {
        if (!redirectTo) focusLater(focusAfterDelete);
      }}
    />
  );
}

/** Copie du diaporama dans le même projet, puis ouverture de la copie. */
export function DuplicateDeckButton({ deckId, decksHref }: { deckId: string; decksHref: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function duplicate() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await duplicateDeck(deckId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`${decksHref}/${result.data.deckId}?copie=1`);
      } catch {
        setError("La connexion a été interrompue. Réessayez.");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="ghost" onClick={duplicate} aria-disabled={pending || undefined}>
        <ButtonLabel idle="Dupliquer le diaporama" busy="Duplication…" isBusy={pending} />
      </Button>
      <LiveRegion role="alert" className="basis-full text-sm font-medium text-danger">
        {error}
      </LiveRegion>
    </>
  );
}
