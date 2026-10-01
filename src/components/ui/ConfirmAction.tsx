"use client";

import { useId, useRef, useState, useTransition } from "react";

interface ConfirmActionProps {
  /** Libellé du bouton déclencheur (ex. « Supprimer »). */
  triggerLabel: string;
  /** Nom accessible complet du déclencheur (ex. « Supprimer le thème Énergie »). */
  triggerAccessibleLabel?: string;
  /** Question affichée dans la confirmation. */
  question: string;
  confirmLabel: string;
  pendingLabel?: string;
  /** Renvoie un message d'erreur, ou null si l'action a réussi. */
  onConfirm: () => Promise<string | null>;
  triggerClassName?: string;
}

/**
 * Confirmation en ligne d'une action destructive (pas de `confirm()` natif) :
 * le déclencheur laisse place à une question et deux boutons ; le focus va sur
 * « Annuler » (choix sûr par défaut) et revient au déclencheur si on annule.
 */
export function ConfirmAction({
  triggerLabel,
  triggerAccessibleLabel,
  question,
  confirmLabel,
  pendingLabel = "Suppression…",
  onConfirm,
  triggerClassName = "btn btn-danger-ghost btn-sm",
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();

  function cancel() {
    setOpen(false);
    setError(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const message = await onConfirm();
      if (message) setError(message);
    });
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerAccessibleLabel}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      className="flex w-full flex-col gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3 sm:w-auto"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) cancel();
      }}
    >
      <p id={questionId} className="text-sm font-medium">
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-danger btn-sm" onClick={confirm} disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={cancel}
          disabled={pending}
          autoFocus
        >
          Annuler
        </button>
      </div>
      <p role="alert" className="text-sm font-medium text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}
