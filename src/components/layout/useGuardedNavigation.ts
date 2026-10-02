"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type MouseEvent } from "react";
import { useUnsavedRef } from "./UnsavedChanges";

/**
 * Garde « modifications non enregistrées » des liens internes d'un projet :
 * si l'éditeur ouvert a des modifications, le clic est retenu et une
 * confirmation s'affiche (focus sur « Rester sur la page »).
 */
export function useGuardedNavigation() {
  const router = useRouter();
  const dirtyRef = useUnsavedRef();
  const stayRef = useRef<HTMLButtonElement>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const warningId = useId();

  function onLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!dirtyRef?.current || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setPendingHref(href);
    window.setTimeout(() => stayRef.current?.focus(), 0);
  }

  const dialog = pendingHref ? (
    <div
      role="alertdialog"
      aria-labelledby={warningId}
      className="my-3 flex flex-col gap-2 rounded-lg border border-warning/60 bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between"
      onKeyDown={(e) => {
        if (e.key === "Escape") setPendingHref(null);
      }}
    >
      <p id={warningId} className="text-sm font-medium">
        Vos modifications ne sont pas enregistrées. Quitter cette page les abandonne.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button ref={stayRef} variant="ghost" size="small" onClick={() => setPendingHref(null)}>
          Rester sur la page
        </Button>
        <Button
          variant="ghost"
          size="small"
          className="danger-outline"
          onClick={() => {
            if (dirtyRef) dirtyRef.current = false;
            const href = pendingHref;
            setPendingHref(null);
            router.push(href);
          }}
        >
          Quitter sans enregistrer
        </Button>
      </div>
    </div>
  ) : null;

  return { onLinkClick, dialog };
}
