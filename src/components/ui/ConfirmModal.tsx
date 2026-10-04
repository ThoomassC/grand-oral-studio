"use client";

import { Button, Modal } from "@thomascaron/opale-ui";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ButtonLabel } from "./ButtonLabel";

/**
 * Confirmation d'une action destructive ou irréversible, dans une `Modal`
 * d'Opale (centrée, fond assombri, focus piégé, reste de la page inerte).
 *
 * Pourquoi pas `ConfirmDialog` d'Opale : son corps est rendu dans un `<p>`
 * (pas de champ de recopie possible), son bouton Confirmer ne se désactive
 * pas sur une condition (nom à recopier), et Annuler passe en `disabled`
 * pendant l'action (le focus clavier y serait perdu).
 *
 * - focus initial sur le choix sûr (« Annuler »), ou sur `initialFocusRef` ;
 * - Échap, le voile et la croix annulent, sauf pendant l'action (`pending`) ;
 * - pendant l'action, les boutons restent focalisables (`aria-disabled`) ;
 * - à la fermeture, Opale rend le focus à l'élément actif à l'ouverture
 *   (le déclencheur) ; l'appelant peut le placer ailleurs ensuite.
 */
export function ConfirmModal({
  open,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel = "En cours…",
  cancelLabel = "Annuler",
  tone = "danger",
  pending = false,
  confirmBlocked = false,
  confirmDescribedBy,
  initialFocusRef,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Le titre du dialogue, qui le nomme (« Supprimer le projet ? »). */
  title: string;
  /** La phrase sous le titre (ce que l'action va faire), reliée par `aria-describedby`. */
  description?: string;
  /** Le corps : ce que l'action va faire, champ de recopie, erreur. */
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  /** `danger` : bouton de danger d'Opale ; `default` : bouton principal. */
  tone?: "danger" | "default";
  pending?: boolean;
  /** Confirmer reste focalisable mais sans effet (ex. nom pas encore recopié). */
  confirmBlocked?: boolean;
  confirmDescribedBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Synchronisation avec le DOM : la modale focalise d'abord son panneau (effet
  // du parent, joué après celui-ci) ; le choix sûr prend le focus juste après.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => (initialFocusRef?.current ?? cancelRef.current)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, initialFocusRef]);

  function cancel() {
    if (!pending) onCancel();
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      size="small"
      closeOnEsc={!pending}
      closeOnOverlay={!pending}
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
      footer={
        <>
          <Button ref={cancelRef} type="button" variant="ghost" onClick={cancel} aria-disabled={pending || undefined}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => {
              if (!pending && !confirmBlocked) onConfirm();
            }}
            aria-disabled={pending || confirmBlocked || undefined}
            aria-describedby={confirmDescribedBy}
          >
            <ButtonLabel idle={confirmLabel} busy={pendingLabel} isBusy={pending} />
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
