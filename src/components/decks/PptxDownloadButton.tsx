"use client";

import { Button } from "@thomascaron/opale-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { LiveRegion } from "@/components/ui/LiveRegion";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error" } | { kind: "expired" };

/** Nom du fichier depuis Content-Disposition (forme RFC 5987 ou simple), sinon repli. */
function filenameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // nom encodé invalide : forme simple ou repli
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/**
 * Export .pptx via fetch plutôt qu'un simple lien : on peut afficher l'attente,
 * vérifier la réponse (statut, type) et expliquer un échec au lieu de
 * télécharger une page d'erreur JSON.
 */
export function PptxDownloadButton({ href, fallbackName }: { href: string; fallbackName: string }) {
  const pathname = usePathname();
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = state.kind === "busy";

  async function download() {
    if (busy) return;
    setState({ kind: "busy" });
    try {
      const res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) {
        setState({ kind: "expired" });
        return;
      }
      const type = res.headers.get("Content-Type") ?? "";
      if (!res.ok || !type.startsWith(PPTX_MIME)) {
        setState({ kind: "error" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res.headers.get("Content-Disposition"), fallbackName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Laisse au navigateur le temps de démarrer le téléchargement avant de libérer l'URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState({ kind: "done" });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* `startIcon` : Opale place l'icône dans sa propre cellule, sur la ligne du libellé
          (dans `children`, le SVG en bloc passait à la ligne). */}
      <Button
        type="button"
        onClick={download}
        aria-disabled={busy || undefined}
        startIcon={
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
            <path
              d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
      >
        <ButtonLabel idle="Télécharger le .pptx" busy="Préparation du fichier…" isBusy={busy} />
      </Button>
      <LiveRegion className="text-sm font-medium text-success">
        {state.kind === "done" ? "Fichier .pptx téléchargé." : null}
      </LiveRegion>
      <LiveRegion role="alert" className="max-w-md text-sm font-medium text-danger">
        {state.kind === "error" ? (
          "L'export a échoué. Réessayez ; si le problème persiste, utilisez le prompt Canva ci-dessous."
        ) : state.kind === "expired" ? (
          <>
            Votre session a expiré. Reconnectez-vous : votre diaporama est enregistré.{" "}
            <Link href={`/connexion?next=${encodeURIComponent(pathname)}`} className="opale-link">
              Se reconnecter
            </Link>
          </>
        ) : null}
      </LiveRegion>
    </div>
  );
}
