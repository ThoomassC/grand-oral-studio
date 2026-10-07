"use client";

import { opaleThemeScript } from "@thomascaron/opale-ui";
import { THEME_STORAGE_KEY } from "@/components/theme/theme";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { InlineScript } from "@/components/ui/InlineScript";
import "./globals.css";

/**
 * Erreur dans le layout racine lui-même : ce fichier REMPLACE le layout, d'où
 * <html>/<body>, la feuille globale et le script de thème (choix mémorisé dans
 * le navigateur, sinon thème du système). Pas d'export `metadata` possible :
 * titre posé par <title>. La référence est le `digest`, journalisé côté serveur.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="fr" suppressHydrationWarning className="h-full antialiased">
      <head>
        <InlineScript html={opaleThemeScript({ storageKey: THEME_STORAGE_KEY, defaultTheme: "system" })} />
      </head>
      <body className="opale-root flex min-h-full flex-col">
        <title>Erreur · Grand Oral Studio</title>
        <main id="contenu" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          <ErrorPanel title="Grand Oral Studio n'a pas pu s'afficher" error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
