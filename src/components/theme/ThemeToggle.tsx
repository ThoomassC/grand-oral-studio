"use client";

import { useLayoutEffect } from "react";
import { reapplyStoredPreference, toggleTheme } from "./theme-store";

/**
 * Bouton clair / sombre de l'en-tête : une lune en mode clair (« Passer en
 * mode sombre »), un soleil en mode sombre (« Passer en mode clair »).
 *
 * Icône et nom accessible sont choisis par le CSS (variante `dark:`), pas par
 * l'état React : le rendu serveur ne connaît pas toujours le thème affiché
 * (mode système), et le bouton est juste dès la première peinture, sans
 * écart d'hydratation. L'icône masquée est en `visibility: hidden`, donc
 * exclue du nom accessible. Le retour au mode « Système » se fait dans
 * Paramètres > Apparence.
 */
export function ThemeToggle() {
  // Synchronisation avec le DOM : voir reapplyStoredPreference (double montage en développement).
  useLayoutEffect(() => {
    reapplyStoredPreference();
  }, []);

  return (
    <button type="button" className="btn btn-ghost btn-icon" onClick={() => toggleTheme()}>
      <span className="grid h-5 w-5 place-items-center">
        <span className="flex transition-[opacity,transform,visibility] duration-300 ease-out [grid-area:1/1] dark:invisible dark:scale-50 dark:rotate-90 dark:opacity-0">
          <MoonIcon />
          <span className="sr-only">Passer en mode sombre</span>
        </span>
        <span className="invisible flex scale-50 -rotate-90 opacity-0 transition-[opacity,transform,visibility] duration-300 ease-out [grid-area:1/1] dark:visible dark:scale-100 dark:rotate-0 dark:opacity-100">
          <SunIcon />
          <span className="sr-only">Passer en mode clair</span>
        </span>
      </span>
    </button>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </svg>
  );
}
