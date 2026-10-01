/**
 * Préférence de thème, partagée entre le serveur (lecture du cookie dans le
 * layout racine) et le client (bouton de l'en-tête, page Paramètres).
 *
 * - « light » / « dark » : choix explicite, posé en `data-theme` sur <html>,
 *   mémorisé dans localStorage et dans le cookie `theme` (le serveur rend
 *   alors directement le bon thème) ;
 * - « system » : aucun attribut, aucun cookie ; le CSS suit `prefers-color-scheme`.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ExplicitTheme = Exclude<ThemePreference, "system">;

export const THEME_COOKIE = "theme";
export const THEME_STORAGE_KEY = "theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Valeur de cookie ou de stockage → thème explicite, sinon null (= système). */
export function parseExplicitTheme(value: unknown): ExplicitTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

/**
 * Script inline exécuté pendant l'analyse du <head>, avant la première
 * peinture : applique le choix mémorisé dans localStorage (au cas où le cookie
 * aurait disparu) et resynchronise le cookie. Sans choix mémorisé, il ne
 * touche à rien : l'attribut rendu par le serveur (cookie) ou le mode système
 * s'applique. Autorisé par la CSP (`script-src 'self' 'unsafe-inline'`).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){d.setAttribute("data-theme",t);if(!new RegExp("(?:^|; )${THEME_COOKIE}="+t+"(?:;|$)").test(document.cookie))document.cookie="${THEME_COOKIE}="+t+"; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax"}}catch(e){}})()`;
