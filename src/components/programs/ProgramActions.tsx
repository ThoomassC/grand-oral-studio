"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProgram, duplicateProgram } from "@/server/actions/programs";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";

export function ProgramActions({
  programId,
  programName,
  focusAfterDelete,
}: {
  programId: string;
  programName: string;
  /** Ids à focaliser après suppression, par ordre de préférence. */
  focusAfterDelete: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  function duplicate() {
    if (pending) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await duplicateProgram(programId);
        if (!result.ok) {
          setMessage({ kind: "error", text: result.error });
          return;
        }
        setMessage({ kind: "success", text: `Copie de « ${programName} » créée en tête de liste.` });
        router.refresh();
      } catch {
        setMessage({ kind: "error", text: "La connexion a été interrompue. Réessayez." });
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={duplicate}
          aria-disabled={pending || undefined}
          aria-label={pending ? `Duplication de ${programName} en cours` : `Dupliquer le projet ${programName}`}
        >
          <ButtonLabel idle="Dupliquer" busy="Duplication…" isBusy={pending} />
        </Button>
        <ConfirmAction
          triggerLabel="Supprimer"
          triggerAccessibleLabel={`Supprimer le projet ${programName}`}
          title="Supprimer le projet ?"
          question={`Supprimer « ${programName} », ses thèmes, squelettes et decks ? Cette action est définitive.`}
          confirmLabel="Supprimer définitivement"
          requireText={programName}
          onConfirm={async () => {
            const result = await deleteProgram(programId);
            return result.ok ? null : result.error;
          }}
          onDone={() => focusLater(focusAfterDelete)}
        />
      </div>
      <LiveRegion className={`text-sm ${message?.kind === "error" ? "text-danger" : "text-success"}`}>
        {message?.text}
      </LiveRegion>
    </div>
  );
}
