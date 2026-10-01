"use client";

import { useSyncExternalStore } from "react";
import {
  parseExplicitTheme,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_STORAGE_KEY,
  type ExplicitTheme,
  type ThemePreference,
} from "./theme";

/**
 * Source de vérité côté client : l'attribut `data-theme` de <html>. Le bouton
 * de l'en-tête et les choix de la page Paramètres lisent et écrivent ici, et
 * se synchronisent par un événement (même onglet) et `storage` (autres onglets).
 */
const CHANGE_EVENT = "grand-oral-studio:theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readPreference(): ThemePreference {
  return parseExplicitTheme(document.documentElement.getAttribute("data-theme")) ?? "system";
}

/** Thème réellement affiché (le mode système est résolu par la media query). */
export function resolvedTheme(preference: ThemePreference = readPreference()): ExplicitTheme {
  if (preference !== "system") return preference;
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

function applyAttribute(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

/** Applique et mémorise un choix (localStorage + cookie lu par le serveur). */
export function setPreference(preference: ThemePreference): void {
  applyAttribute(preference);
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Stockage indisponible (navigation privée) : le cookie suffit au serveur.
  }
  document.cookie =
    preference === "system"
      ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`
      : `${THEME_COOKIE}=${preference}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Bascule clair ↔ sombre à partir du thème affiché ; renvoie le nouveau thème. */
export function toggleTheme(): ExplicitTheme {
  const next: ExplicitTheme = resolvedTheme() === "dark" ? "light" : "dark";
  setPreference(next);
  return next;
}

/**
 * Réapplique le choix mémorisé. En développement, le double montage du mode
 * strict remet les attributs de <html> à ceux du JSX (voir le guide Next
 * « Preventing flash before hydration ») ; sans effet en production.
 */
export function reapplyStoredPreference(): void {
  try {
    const stored = parseExplicitTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
    if (stored) applyAttribute(stored);
  } catch {
    // Rien à réappliquer.
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== null) return;
    applyAttribute(parseExplicitTheme(e.newValue) ?? "system");
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Préférence courante, synchronisée entre composants et onglets.
 * `serverPreference` (cookie lu par le serveur) sert au rendu serveur et à
 * l'hydratation ; le DOM fait foi ensuite.
 */
export function useThemePreference(serverPreference: ThemePreference): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => serverPreference);
}

function subscribeResolved(onChange: () => void): () => void {
  const unsubscribe = subscribe(onChange);
  const media = window.matchMedia?.(DARK_QUERY);
  media?.addEventListener?.("change", onChange);
  return () => {
    unsubscribe();
    media?.removeEventListener?.("change", onChange);
  };
}

/**
 * Thème réellement affiché, y compris en mode système (suit aussi les
 * changements du réglage de l'appareil). Rendu serveur : le choix du cookie,
 * sinon « light » (le mode système n'est pas connu du serveur) ; corrigé dès
 * l'hydratation, sans écart signalé.
 */
export function useResolvedTheme(serverTheme: ExplicitTheme | null = null): ExplicitTheme {
  return useSyncExternalStore(subscribeResolved, () => resolvedTheme(), () => serverTheme ?? "light");
}
