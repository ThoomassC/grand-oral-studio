/**
 * Retour d'erreur du parcours OAuth : Better Auth redirige vers
 * `errorCallbackURL?error=<code>` (codes de oauth2/errors, ou ceux renvoyés par
 * Google comme `access_denied`). On traduit en message fixe : le code brut,
 * contrôlé par l'URL, n'est jamais affiché.
 */
const MESSAGES: Record<string, string> = {
  access_denied: "La connexion avec Google a été annulée ou refusée. Réessayez.",
  // Liaison Google ↔ compte e-mail existant refusée (ACCOUNT_LINKING_OPTIONS).
  account_not_linked: "Un compte existe déjà avec cette adresse. Connectez-vous avec votre e-mail et votre mot de passe.",
  email_not_found: "Google n'a pas transmis d'adresse e-mail. Créez un compte avec votre adresse et un mot de passe.",
};

const FALLBACK = "La connexion avec Google a échoué. Réessayez dans un instant.";

export function oauthErrorMessage(raw: string | string[] | undefined): string | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK;
}
