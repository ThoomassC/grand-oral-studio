"use client";

import { Button } from "@thomascaron/opale-ui";
import { useState, useTransition } from "react";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { downloadJson } from "./download";

/**
 * Bouton de téléchargement d'un export JSON (`Button` d'Opale, variante
 * secondaire) : attente annoncée, puis « Téléchargement lancé. » ou l'erreur
 * renvoyée par la route (quota, session expirée…).
 */
export function DownloadButton({
  href,
  label,
  busyLabel = "Préparation du fichier…",
  fallbackName,
}: {
  href: string;
  label: string;
  busyLabel?: string;
  fallbackName: string;
}) {
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ ok: true } | { ok: false; message: string } | null>(null);

  function download() {
    if (busy) return;
    setResult(null);
    start(async () => {
      setResult(await downloadJson(href, fallbackName));
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="secondary" onClick={download} aria-disabled={busy || undefined}>
        <ButtonLabel idle={label} busy={busyLabel} isBusy={busy} />
      </Button>
      <LiveRegion className="text-sm font-medium text-success">
        {result?.ok ? (
          <>
            <span aria-hidden="true">✓ </span>
            Téléchargement lancé.
          </>
        ) : null}
      </LiveRegion>
      <LiveRegion role="alert" className="text-sm font-medium text-danger">
        {result && !result.ok ? result.message : null}
      </LiveRegion>
    </div>
  );
}
