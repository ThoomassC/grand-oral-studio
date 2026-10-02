"use client";

import { useOpaleTheme, type UseOpaleThemeResult } from "@thomascaron/opale-ui";
import { createContext, use, useEffect, type ReactNode } from "react";
import { THEME_STORAGE_KEY, themeCookie, type ThemePreference } from "./theme";

const ThemeContext = createContext<UseOpaleThemeResult | null>(null);

/**
 * L'unique appel à `useOpaleTheme` (Opale : « un seul appel par cible »),
 * partagé par le bouton de l'en-tête et le panneau Réglages.
 *
 * `defaultTheme` est le choix lu dans le cookie par le serveur (sinon
 * « system ») : il est aussi passé à `opaleThemeScript`, pour que le script,
 * le rendu serveur et React s'accordent.
 */
export function ThemeProvider({ defaultTheme, children }: { defaultTheme: ThemePreference; children: ReactNode }) {
  const value = useOpaleTheme({ storageKey: THEME_STORAGE_KEY, defaultTheme });

  // Synchronisation avec un système extérieur : le cookie lu par le serveur.
  useEffect(() => {
    document.cookie = themeCookie(value.theme);
  }, [value.theme]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): UseOpaleThemeResult {
  const value = use(ThemeContext);
  if (!value) throw new Error("useTheme doit être appelé sous <ThemeProvider>.");
  return value;
}
