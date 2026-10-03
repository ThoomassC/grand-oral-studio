"use client";

import { Button, Icon, Modal } from "@thomascaron/opale-ui";
import { useRef, useState } from "react";
import { CreateProgramForm } from "./CreateProgramForm";

/**
 * Bouton « Nouveau projet » qui ouvre une `Modal` d'Opale contenant
 * `CreateProgramForm`. Focus sur le nom à l'ouverture ; Échap, le voile, la
 * croix et « Annuler » ferment (sauf pendant la création) et rendent le focus
 * au bouton. Après succès, le formulaire ouvre la page du projet.
 *
 * Chaque ouverture remonte un formulaire neuf (`key`) : une saisie abandonnée
 * ne réapparaît pas.
 */
export function CreateProgramDialog({
  label = "Nouveau projet",
  variant = "primary",
}: {
  /** Libellé du bouton (ex. « Créer mon premier projet » dans l'état vide). */
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Change à chaque ouverture : le formulaire repart vide. */
  const [session, setSession] = useState(0);

  function show() {
    setBusy(false);
    setSession((n) => n + 1);
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    // Après le démontage de la modale : le bouton qui l'a ouverte, toujours.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant={variant}
        aria-haspopup="dialog"
        startIcon={<Icon name="plus" />}
        onClick={show}
      >
        {label}
      </Button>
      <Modal
        open={open}
        title="Nouveau projet"
        description="Une charte neutre et un gabarit par défaut sont créés ; vous les ajusterez ensuite."
        size="medium"
        closeOnEsc={!busy}
        closeOnOverlay={!busy}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        {open ? <CreateProgramForm key={session} autoFocus onCancel={close} onBusyChange={setBusy} /> : null}
      </Modal>
    </>
  );
}
