"use client";

import { Icon } from "@thomascaron/opale-ui";
import { useTheme } from "./ThemeProvider";

/**
 * Bouton clair / sombre de l'en-tête, à l'apparence de `HeaderThemeToggle`
 * d'Opale (boîte encadrée, lune au primaire, soleil à l'accent) : bouton bascule de nom fixe « Mode
 * sombre », `aria-pressed` = thème sombre affiché (mode système compris). Un
 * seul nom à tout instant ; l'état change, pas le libellé.
 *
 * L'icône (lune en clair, soleil en sombre) est choisie par le CSS (variante
 * `dark:`, qui lit le `data-theme` posé avant la première peinture) : juste
 * dès l'affichage, avant l'hydratation. Le retour au mode « Système » se fait
 * dans Réglages > Apparence (bouton voisin de l'en-tête).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      className="header-control header-control--square"
      aria-label="Mode sombre"
      aria-pressed={resolvedTheme === "dark"}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <span aria-hidden="true" className="grid place-items-center">
        <span className="header-control__moon flex transition-[opacity,transform,visibility] duration-300 ease-out [grid-area:1/1] dark:invisible dark:scale-50 dark:rotate-90 dark:opacity-0">
          <Icon name="moon" />
        </span>
        <span className="header-control__sun invisible flex scale-50 -rotate-90 opacity-0 transition-[opacity,transform,visibility] duration-300 ease-out [grid-area:1/1] dark:visible dark:scale-100 dark:rotate-0 dark:opacity-100">
          <Icon name="sun" />
        </span>
      </span>
    </button>
  );
}
