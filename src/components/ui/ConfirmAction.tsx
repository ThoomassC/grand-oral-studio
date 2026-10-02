"use client";

import { Button, Input, type ButtonVariant } from "@thomascaron/opale-ui";
import { DANGER_OUTLINE } from "./ButtonLink";
import { useId, useRef, useState, useTransition } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { LiveRegion } from "./LiveRegion";

interface ConfirmActionProps {
  /** Libellé du bouton déclencheur (ex. « Supprimer »). */
  triggerLabel: string;
  /** Nom accessible complet du déclencheur (ex. « Supprimer le thème Énergie »). */
  triggerAccessibleLabel?: string;
  /** Titre de la modale, qui la nomme (ex. « Supprimer le projet ? »). Défaut : « <triggerLabel> ? ». */
  title?: string;
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
  /** Taille du déclencheur. Défaut : `small`. */
  size?: "small" | "medium";
  /** Désactive le déclencheur (autre action en cours). */
  triggerDisabled?: boolean;
  triggerId?: string;
}

/**
 * Confirmation d'une action destructive dans une `Modal` d'Opale (pas de
 * `confirm()` natif) : le déclencheur ouvre la modale ; le focus va sur
 * « Annuler » (choix sûr par défaut), ou sur le champ de recopie ; Échap, le
 * voile et la croix annulent, sauf pendant l'action. En annulant, le focus
 * revient au déclencheur ; après succès, `onDone` le place (l'élément visé a
 * pu disparaître). Pendant l'action, les boutons restent focalisables
 * (`aria-disabled`) pour ne pas perdre le focus.
 */
export function ConfirmAction({
  triggerLabel,
  triggerAccessibleLabel,
  title,
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
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const errorId = `${baseId}-error`;
  const matches = !requireText || typed.trim() === requireText.trim();

  function reset() {
    setOpen(false);
    setError(null);
    setTyped("");
  }

  function cancel() {
    if (pending) return;
    reset();
    // Après le démontage : la modale rend le focus à l'élément actif à son ouverture.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function confirm() {
    if (pending) return;
    if (!matches) {
      setError(`Recopiez exactement « ${requireText} » pour confirmer.`);
      inputRef.current?.focus();
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
      reset();
      onDone?.();
    });
  }

  return (
    <>
      <Button
        ref={triggerRef}
        id={triggerId}
        variant={triggerVariant === "danger-outline" ? "ghost" : triggerVariant}
        size={size}
        className={triggerVariant === "danger-outline" ? DANGER_OUTLINE : undefined}
        aria-label={triggerAccessibleLabel}
        aria-haspopup="dialog"
        aria-disabled={triggerDisabled || undefined}
        onClick={() => {
          if (!triggerDisabled) setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
      <ConfirmModal
        open={open}
        title={title ?? `${triggerLabel} ?`}
        description={question}
        confirmLabel={confirmLabel}
        pendingLabel={pendingLabel}
        pending={pending}
        confirmBlocked={!matches}
        confirmDescribedBy={error ? errorId : undefined}
        initialFocusRef={requireText ? inputRef : undefined}
        onConfirm={confirm}
        onCancel={cancel}
      >
        <div className="flex flex-col gap-4">
          {requireText ? (
            <Input
              ref={inputRef}
              id={inputId}
              label={`Recopiez « ${requireText} » pour confirmer`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
              aria-describedby={error ? errorId : undefined}
              autoComplete="off"
              spellCheck={false}
            />
          ) : null}
          <LiveRegion role="alert">
            {error ? (
              <p id={errorId} className="text-sm font-medium text-danger">
                <span aria-hidden="true">Erreur : </span>
                {error}
              </p>
            ) : null}
          </LiveRegion>
        </div>
      </ConfirmModal>
    </>
  );
}
