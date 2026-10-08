"use client";

import { Button } from "@thomascaron/opale-ui";
import { ConfirmAction } from "@/components/ui/ConfirmAction";

/** Identifiants des boutons d'une carte, pour replacer le focus après une modification. */
export function slideActionIds(baseId: string, index: number) {
  return {
    edit: `${baseId}-edit-${index}`,
    insert: `${baseId}-insert-${index}`,
    up: `${baseId}-up-${index}`,
    down: `${baseId}-down-${index}`,
    regenerate: `${baseId}-regenerate-${index}`,
    remove: `${baseId}-remove-${index}`,
  };
}

/**
 * Rangée d'actions d'une carte de diapo (éditeur) : « Modifier », réécriture par
 * l'IA, insertion après, déplacement d'un cran, suppression. La couverture (en
 * tête) ne monte, ne descend ni ne se supprime ; la diapo qui la suit ne monte
 * pas. Toutes les actions sont inertes (`aria-disabled`) pendant une édition ou
 * une modification en cours.
 */
export function SlideActions({
  baseId,
  index,
  count,
  coverLocked,
  disabled,
  aiAvailable,
  onEdit,
  onInsert,
  onMove,
  onRegenerate,
  onRemove,
  onRemoved,
}: {
  baseId: string;
  index: number;
  count: number;
  /** Le deck commence par une couverture : elle reste en tête. */
  coverLocked: boolean;
  disabled: boolean;
  aiAvailable: boolean;
  onEdit: () => void;
  onInsert: () => void;
  onMove: (direction: "up" | "down") => void;
  /** Renvoie un message d'erreur, ou null en cas de succès. */
  onRegenerate: () => Promise<string | null>;
  /** Renvoie un message d'erreur, ou null en cas de succès. */
  onRemove: () => Promise<string | null>;
  onRemoved: () => void;
}) {
  const ids = slideActionIds(baseId, index);
  const n = index + 1;
  const isCover = coverLocked && index === 0;
  const canMoveUp = !isCover && index > (coverLocked ? 1 : 0);
  const canMoveDown = !isCover && index < count - 1;
  const guard = (fn: () => void) => () => {
    if (!disabled) fn();
  };

  return (
    <div className="mt-auto flex flex-wrap gap-2">
      <Button id={ids.edit} type="button" variant="ghost" size="small" onClick={guard(onEdit)} aria-disabled={disabled || undefined}>
        Modifier<span className="sr-only"> la diapo {n}</span>
      </Button>
      {aiAvailable ? (
        <ConfirmAction
          triggerId={ids.regenerate}
          triggerLabel="Régénérer avec l'IA"
          triggerAccessibleLabel={`Régénérer la diapo ${n} avec l'IA`}
          triggerVariant="ghost"
          triggerDisabled={disabled}
          title="Régénérer la diapo ?"
          question={`Le titre, les puces et les notes de la diapo ${n} seront remplacés par une nouvelle version rédigée par l'IA.`}
          confirmLabel="Régénérer la diapo"
          pendingLabel="Rédaction…"
          onConfirm={onRegenerate}
        />
      ) : null}
      <Button id={ids.insert} type="button" variant="ghost" size="small" onClick={guard(onInsert)} aria-disabled={disabled || undefined}>
        Insérer une diapo après<span className="sr-only"> la diapo {n}</span>
      </Button>
      {canMoveUp ? (
        <Button id={ids.up} type="button" variant="ghost" size="small" onClick={guard(() => onMove("up"))} aria-disabled={disabled || undefined}>
          Monter<span className="sr-only"> la diapo {n}</span>
        </Button>
      ) : null}
      {canMoveDown ? (
        <Button
          id={ids.down}
          type="button"
          variant="ghost"
          size="small"
          onClick={guard(() => onMove("down"))}
          aria-disabled={disabled || undefined}
        >
          Descendre<span className="sr-only"> la diapo {n}</span>
        </Button>
      ) : null}
      {isCover ? null : (
        <ConfirmAction
          triggerId={ids.remove}
          triggerLabel="Supprimer la diapo"
          triggerAccessibleLabel={`Supprimer la diapo ${n}`}
          triggerDisabled={disabled}
          title="Supprimer la diapo ?"
          question={`La diapo ${n} et ses notes d'orateur seront retirées du diaporama.`}
          confirmLabel="Supprimer la diapo"
          onConfirm={onRemove}
          onDone={onRemoved}
        />
      )}
    </div>
  );
}
