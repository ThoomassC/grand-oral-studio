"use client";

import { Button, useToast } from "@thomascaron/opale-ui";
import { useTransition } from "react";
import { ButtonLabel } from "@/components/ui/ButtonLabel";

/**
 * Notification « Supprimé. [Annuler] » après une mise à la corbeille (projet,
 * diaporama). Le serveur garde l'élément restaurable 30 s ; l'interface annonce
 * 10 s (la notification se met en pause au survol et au focus, la marge couvre
 * ce délai). La notification vit dans le `ToastProvider` de la racine : elle
 * survit au démontage de la ligne supprimée ou à la redirection.
 */

/** Durée d'affichage de l'annulation. */
export const UNDO_TOAST_MS = 10_000;

export interface UndoToastOptions {
  /** Identifiant stable (une nouvelle suppression du même élément remplace la notification). */
  id: string;
  /** « Diaporama supprimé. » */
  message: string;
  /** Nom accessible complet du bouton (« Annuler la suppression du diaporama X »). */
  undoAccessibleLabel: string;
  /** Message affiché après restauration réussie. */
  restoredMessage: string;
  /** Restaure ; renvoie un message d'erreur, ou null en cas de succès. */
  onUndo: () => Promise<string | null>;
}

function UndoButton({ accessibleLabel, onUndo }: { accessibleLabel: string; onUndo: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="small"
      className="mt-2"
      aria-label={accessibleLabel}
      aria-disabled={pending || undefined}
      onClick={() => {
        if (pending) return;
        startTransition(onUndo);
      }}
    >
      <ButtonLabel idle="Annuler" busy="Restauration…" isBusy={pending} />
    </Button>
  );
}

/** Renvoie `showUndo(options)` ; exige le `ToastProvider` d'Opale (posé dans le layout racine). */
export function useUndoToast(): (options: UndoToastOptions) => void {
  const { showToast, dismissToast } = useToast();
  return (options) => {
    const id = showToast({
      id: options.id,
      tone: "neutral",
      title: options.message,
      duration: UNDO_TOAST_MS,
      description: (
        <UndoButton
          accessibleLabel={options.undoAccessibleLabel}
          onUndo={async () => {
            let error: string | null;
            try {
              error = await options.onUndo();
            } catch {
              error = "La connexion a été interrompue. Réessayez.";
            }
            dismissToast(id);
            showToast(
              error
                ? { id: `${options.id}-erreur`, tone: "error", title: "Annulation impossible.", description: error }
                : { id: `${options.id}-restaure`, tone: "success", title: options.restoredMessage },
            );
          }}
        />
      ),
    });
  };
}
