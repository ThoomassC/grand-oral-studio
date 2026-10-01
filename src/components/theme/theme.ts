/**
 * Préférence de thème, partagée entre le serveur (lecture du cookie dans le
 * layout racine) et le client (bouton de l'en-tête, page Paramètres).
 *
 * Le mécanisme est celui d'Opale (`opaleThemeScript` + `useOpaleTheme`) :
 * la préférence (« light », « dark » ou « system ») est mémorisée dans
 * localStorage sous `THEME_STORAGE_KEY`, et le thème résolu est toujours posé
 * en `data-theme` sur <html>. En plus, un cookie `theme` recopie un choix
 * explicite : le serveur rend alors directement le bon `data-theme`.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ExplicitTheme = Exclude<ThemePreference, "system">;

export const THEME_COOKIE = "theme";
export const THEME_STORAGE_KEY = "theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Valeur de cookie → thème explicite, sinon null (= système). */
export function parseExplicitTheme(value: unknown): ExplicitTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** Écriture du cookie lu par le serveur : un choix explicite, ou rien pour « système ». */
export function themeCookie(preference: ThemePreference): string {
  return preference === "system"
    ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`
    : `${THEME_COOKIE}=${preference}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
}
