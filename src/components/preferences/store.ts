"use client";

import { useSyncExternalStore } from "react";
import {
  applyPreferences,
  DEFAULT_PREFERENCES,
  parsePreferences,
  PREFERENCES_STORAGE_KEY,
  readStoredPreferences,
  writeStoredPreferences,
  type SitePreferences,
  type StorageAccess,
} from "./preferences";

/**
 * Réglages du site lus comme un magasin externe (`useSyncExternalStore`) :
 * localStorage est la source de vérité ; l'instantané n'est recalculé que si
 * la valeur brute change (référence stable, pas de rendu en boucle). Les
 * autres onglets suivent par l'événement `storage`.
 *
 * Stockage indisponible (navigation privée stricte, quota plein) : le réglage
 * s'applique quand même, le temps de la visite.
 */

const CHANGE_EVENT = "grand-oral-studio:reglages-change";
const storage: StorageAccess = () => window.localStorage;

let cache: { raw: string | null; value: SitePreferences } | null = null;
/** Valeur de la visite, quand le stockage n'a pas pu la mémoriser. */
let unsaved: SitePreferences | null = null;

export function getPreferencesSnapshot(): SitePreferences {
  if (unsaved) return unsaved;
  const read = readStoredPreferences(storage);
  if (!read.available) return DEFAULT_PREFERENCES;
  if (cache?.raw === read.raw) return cache.value;
  cache = { raw: read.raw, value: parsePreferences(read.raw) };
  return cache.value;
}

function getServerSnapshot(): SitePreferences {
  return DEFAULT_PREFERENCES;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // `key === null` : stockage vidé (clear()) dans un autre onglet.
    if (event.key !== null && event.key !== PREFERENCES_STORAGE_KEY) return;
    unsaved = null;
    applyPreferences(document.documentElement, getPreferencesSnapshot());
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
 * Applique tout de suite sur <html>, mémorise et prévient les abonnés.
 * Renvoie `false` si le réglage n'a pas pu être mémorisé (il vaut alors pour la visite).
 */
export function setPreferences(next: SitePreferences): boolean {
  const saved = writeStoredPreferences(storage, next);
  unsaved = saved ? null : next;
  applyPreferences(document.documentElement, next);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return saved;
}

export function updatePreferences(patch: Partial<SitePreferences>): boolean {
  return setPreferences({ ...getPreferencesSnapshot(), ...patch });
}

export function usePreferences(): SitePreferences {
  return useSyncExternalStore(subscribe, getPreferencesSnapshot, getServerSnapshot);
}

/**
 * À lire par tout code qui anime en JavaScript (défilement doux…) : vrai si
 * l'utilisateur a choisi « Réduire les animations » dans Réglages, ou si son
 * appareil le demande (`prefers-reduced-motion`).
 */
export function prefersReducedMotion(): boolean {
  if (getPreferencesSnapshot().motion === "reduced") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Tests seulement : oublie l'état de module (cache, valeur de la visite). */
export function resetPreferencesStoreForTests(): void {
  cache = null;
  unsaved = null;
}
