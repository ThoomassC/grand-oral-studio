"use client";

import { Button, Input, type ButtonVariant } from "@thomascaron/opale-ui";
import { DANGER_OUTLINE } from "./ButtonLink";
import { useId, useRef, useState, useTransition } from "react";
import { ButtonLabel } from "./ButtonLabel";
import { LiveRegion } from "./LiveRegion";

interface ConfirmActionProps {
  /** Libellé du bouton déclencheur (ex. « Supprimer »). */
  triggerLabel: string;
  /** Nom accessible complet du déclencheur (ex. « Supprimer le thème Énergie »). */
  triggerAccessibleLabel?: string;
  /** Question affichée dans la confirmation. */
  question: string;
  confirmLabel: string;
  pendingLabel?: string;
  /**
   * Texte à recopier pour activer la confirmation (ex. le nom du projet).
   * Réservé aux suppressions lourdes.
   */
  requireText?: string;
  /** Renvoie un message d'erreur, ou null si l'action a réussi. */
  onConfirm: () => Promise<string | null>;
  /** Appelé après succès : le parent place le focus (l'élément a pu disparaître). */
  onDone?: () => void;
  /** Rôle visuel du déclencheur (`Button` d'Opale) ; `danger-outline` : contour de danger (défaut). */
  triggerVariant?: ButtonVariant | "danger-outline";
  /** Taille du déclencheur et des boutons de confirmation. Défaut : `small`. */
  size?: "small" | "medium";
  /** Désactive le déclencheur (autre action en cours). */
  triggerDisabled?: boolean;
  triggerId?: string;
}

/**
 * Confirmation en ligne d'une action destructive (pas de `confirm()` natif) :
 * le déclencheur laisse place à une question et deux boutons ; le focus va sur
 * « Annuler » (choix sûr par défaut), ou sur le champ de recopie, et revient
 * au déclencheur si on annule. Pendant l'action, les boutons restent
 * focalisables (`aria-disabled`) pour ne pas perdre le focus.
 */
export function ConfirmAction({
  triggerLabel,
  triggerAccessibleLabel,
  question,
  confirmLabel,
  pendingLabel = "Suppression…",
  requireText,
  onConfirm,
  onDone,
  triggerVariant = "danger-outline",
  size = "small",
  triggerDisabled = false,
  triggerId,
}: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const inputId = useId();
  const matches = !requireText || typed.trim() === requireText.trim();

  function cancel() {
    if (pending) return;
    setOpen(false);
    setError(null);
    setTyped("");
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function confirm() {
    if (pending) return;
    if (!matches) {
      setError(`Recopiez exactement « ${requireText} » pour confirmer.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      let message: string | null;
      try {
        message = await onConfirm();
      } catch {
        message = "La connexion a été interrompue. Réessayez.";
      }
      if (message) {
        setError(message);
        return;
      }
      setOpen(false);
      setTyped("");
      onDone?.();
    });
  }

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        id={triggerId}
        variant={triggerVariant === "danger-outline" ? "ghost" : triggerVariant}
        size={size}
        className={triggerVariant === "danger-outline" ? DANGER_OUTLINE : undefined}
        aria-label={triggerAccessibleLabel}
        aria-disabled={triggerDisabled || undefined}
        onClick={() => {
          if (!triggerDisabled) setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      className="flex w-full flex-col gap-3 rounded-lg border border-danger/40 bg-danger-soft p-4 sm:w-auto sm:max-w-md"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <p id={questionId} className="text-sm font-medium">
        {question}
      </p>
      {requireText ? (
        <Input
            id={inputId}
            label={`Recopiez « ${requireText} » pour confirmer`}
            size="small"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirm();
              }
            }}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size={size} onClick={confirm} aria-disabled={pending || !matches || undefined}>
          <ButtonLabel idle={confirmLabel} busy={pendingLabel} isBusy={pending} />
        </Button>
        <Button
          variant="ghost"
          size={size}
          onClick={cancel}
          aria-disabled={pending || undefined}
          autoFocus={!requireText}
        >
          Annuler
        </Button>
      </div>
      <LiveRegion role="alert">
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      </LiveRegion>
    </div>
  );
}
