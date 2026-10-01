"use client";

import { THEME_INIT_SCRIPT } from "./theme";

/**
 * Script inline du <head> qui applique le thème mémorisé avant la première
 * peinture. Composant client pour la seule raison donnée par le guide Next
 * « Preventing flash before hydration » : React avertit en développement
 * quand il rend un <script> côté client ; on le rend donc `text/plain` (inerte)
 * côté client et `text/javascript` côté serveur, l'écart étant accepté par
 * suppressHydrationWarning. Le script s'exécute une fois, au chargement HTML.
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
