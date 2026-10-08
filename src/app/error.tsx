"use client";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

/**
 * Erreur non prévue dans une page (sous le layout racine, qui reste affiché).
 * La référence affichée est le `digest` de Next, journalisé côté serveur par
 * `onRequestError` (src/instrumentation.ts) : elle permet de retrouver la panne.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
