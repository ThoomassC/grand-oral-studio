/**
 * Téléchargement d'un export (JSON) par fetch plutôt qu'un simple lien : on
 * vérifie la réponse (statut, type) et on explique un échec au lieu de faire
 * enregistrer au navigateur une page d'erreur JSON. Même principe que
 * l'export .pptx (PptxDownloadButton).
 */

export type DownloadOutcome = { ok: true } | { ok: false; message: string };

const EXPIRED = "Votre session a expiré : reconnectez-vous, puis réessayez.";
const FAILED = "Le téléchargement a échoué. Réessayez dans un instant.";

/** Nom du fichier depuis Content-Disposition (forme RFC 5987 ou simple), sinon repli. */
export function filenameFrom(header: string | null, fallback: string): string {
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

/** Message d'erreur d'une réponse JSON `{ error }` de nos routes, sinon le message générique. */
async function errorMessage(res: Response): Promise<string> {
  if (!(res.headers.get("Content-Type") ?? "").startsWith("application/json")) return FAILED;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error) {
      return body.error;
    }
  } catch {
    // corps illisible : message générique
  }
  return FAILED;
}

/** Télécharge `href` (fichier JSON) sous le nom donné par le serveur, ou `fallbackName`. */
export async function downloadJson(href: string, fallbackName: string): Promise<DownloadOutcome> {
  let res: Response;
  try {
    res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
  } catch {
    return { ok: false, message: FAILED };
  }
  if (res.status === 401) return { ok: false, message: EXPIRED };
  if (!res.ok) return { ok: false, message: await errorMessage(res) };
  if (!(res.headers.get("Content-Type") ?? "").startsWith("application/json")) return { ok: false, message: FAILED };
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
  return { ok: true };
}
