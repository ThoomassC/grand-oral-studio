/**
 * Réglages du site propres à l'appareil (panneau « Réglages » de l'en-tête) :
 * taille du texte et animations. Le thème n'est pas ici : sa source de vérité
 * reste `ThemeProvider` (components/theme).
 *
 * Logique pure, sans React ni accès global : le stockage est passé en
 * paramètre, ce qui la rend testable et sûre au rendu serveur. Mémorisé dans
 * localStorage sous une clé versionnée ; toute valeur lue est validée champ
 * par champ (une valeur inconnue ou corrompue retombe sur son défaut).
 *
 * Appliqué sur <html> par deux attributs que lit globals.css :
 * `data-text-size` (taille de la racine) et `data-motion` (animations).
 */

export const TEXT_SIZES = ["standard", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** `system` : suivre `prefers-reduced-motion` ; `reduced` : toujours réduire. */
export const MOTION_PREFERENCES = ["system", "reduced"] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

export interface SitePreferences {
  readonly textSize: TextSize;
  readonly motion: MotionPreference;
}

export const DEFAULT_PREFERENCES: SitePreferences = Object.freeze({ textSize: "standard", motion: "system" });

/** Changer la forme mémorisée ⇒ changer de version (l'ancienne valeur est alors ignorée). */
export const PREFERENCES_STORAGE_KEY = "grand-oral-studio:reglages:v1";
export const TEXT_SIZE_ATTRIBUTE = "data-text-size";
export const MOTION_ATTRIBUTE = "data-motion";

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && (TEXT_SIZES as readonly string[]).includes(value);
}

export function isMotionPreference(value: unknown): value is MotionPreference {
  return typeof value === "string" && (MOTION_PREFERENCES as readonly string[]).includes(value);
}

/** Valeur brute du stockage → réglages valides (jamais d'exception). */
export function parsePreferences(raw: string | null): SitePreferences {
  if (raw === null) return DEFAULT_PREFERENCES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_PREFERENCES;
  const record = value as Record<string, unknown>;
  const textSize = isTextSize(record.textSize) ? record.textSize : DEFAULT_PREFERENCES.textSize;
  const motion = isMotionPreference(record.motion) ? record.motion : DEFAULT_PREFERENCES.motion;
  if (textSize === DEFAULT_PREFERENCES.textSize && motion === DEFAULT_PREFERENCES.motion) return DEFAULT_PREFERENCES;
  return { textSize, motion };
}

export function serializePreferences(preferences: SitePreferences): string {
  return JSON.stringify({ textSize: preferences.textSize, motion: preferences.motion });
}

/** Le strict nécessaire de `Storage`. */
export type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;
/** Accès au stockage : `() => window.localStorage`, qui peut lui-même lever. */
export type StorageAccess = () => PreferencesStorage;

export type StoredRead = { available: true; raw: string | null } | { available: false };

export function readStoredPreferences(storage: StorageAccess): StoredRead {
  try {
    return { available: true, raw: storage().getItem(PREFERENCES_STORAGE_KEY) };
  } catch {
    return { available: false };
  }
}

/** Vrai si la valeur est mémorisée ; faux si le stockage est indisponible ou plein. */
export function writeStoredPreferences(storage: StorageAccess, preferences: SitePreferences): boolean {
  try {
    storage().setItem(PREFERENCES_STORAGE_KEY, serializePreferences(preferences));
    return true;
  } catch {
    return false;
  }
}

export function applyPreferences(root: Pick<Element, "setAttribute">, preferences: SitePreferences): void {
  root.setAttribute(TEXT_SIZE_ATTRIBUTE, preferences.textSize);
  root.setAttribute(MOTION_ATTRIBUTE, preferences.motion);
}

/**
 * Script inline du <head> (layout racine), exécuté avant la première
 * peinture : pose les deux attributs, sans quoi le texte changerait de taille
 * et les animations joueraient avant l'hydratation. Même validation que
 * `parsePreferences` (listes partagées) ; un stockage indisponible ou une
 * valeur corrompue laissent les défauts. Les attributs sont toujours posés.
 */
export function preferencesScript(): string {
  const key = JSON.stringify(PREFERENCES_STORAGE_KEY);
  const sizes = JSON.stringify(TEXT_SIZES);
  const motions = JSON.stringify(MOTION_PREFERENCES);
  const defaults = JSON.stringify(DEFAULT_PREFERENCES);
  return `(function(){var d=${defaults},s=d.textSize,m=d.motion;try{var v=JSON.parse(localStorage.getItem(${key})||"null");if(v&&typeof v==="object"){if(${sizes}.indexOf(v.textSize)>=0)s=v.textSize;if(${motions}.indexOf(v.motion)>=0)m=v.motion}}catch(e){}var r=document.documentElement;r.setAttribute(${JSON.stringify(TEXT_SIZE_ATTRIBUTE)},s);r.setAttribute(${JSON.stringify(MOTION_ATTRIBUTE)},m)})();`;
}
