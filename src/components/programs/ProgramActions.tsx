"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProgram, duplicateProgram } from "@/server/actions/programs";
import { ConfirmAction } from "@/components/ui/ConfirmAction";

export function ProgramActions({ programId, programName }: { programId: string; programName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  function duplicate() {
    setMessage(null);
    startTransition(async () => {
      const result = await duplicateProgram(programId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({ kind: "success", text: `Copie de « ${programName} » créée.` });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={duplicate}
          disabled={pending}
          aria-label={`Dupliquer le programme ${programName}`}
        >
          {pending ? "Duplication…" : "Dupliquer"}
        </button>
        <ConfirmAction
          triggerLabel="Supprimer"
          triggerAccessibleLabel={`Supprimer le programme ${programName}`}
          question={`Supprimer « ${programName} », ses thèmes, squelettes et decks ? Cette action est définitive.`}
          confirmLabel="Supprimer définitivement"
          onConfirm={async () => {
            const result = await deleteProgram(programId);
            return result.ok ? null : result.error;
          }}
        />
      </div>
      <p role="status" className={`text-sm ${message?.kind === "error" ? "text-danger" : "text-success"}`}>
        {message?.text}
      </p>
    </div>
  );
}
