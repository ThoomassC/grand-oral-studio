/**
 * Retour d'erreur vers /connexion : Better Auth redirige vers
 * `errorCallbackURL?error=<code>` après un échec Google (codes de oauth2/errors,
 * ceux renvoyés par Google comme `access_denied`, ou le code d'une APIError levée
 * par un hook), et vers `callbackURL?error=<code>` après un lien de confirmation
 * d'adresse invalide. On traduit en message fixe : le code brut, contrôlé par
 * l'URL, n'est jamais affiché.
 */
/** Partagé avec le serveur (hook de création de compte) et le formulaire d'inscription. */
export const EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE =
  "Cette adresse e-mail n'est pas autorisée sur cette instance. Utilisez une autre adresse ou contactez l'administrateur de l'instance.";

const EXPIRED_VERIFICATION =
  "Ce lien de confirmation n'est plus valide (il a expiré ou a déjà servi). Connectez-vous : un nouveau lien vous sera envoyé.";

const MESSAGES: Record<string, string> = {
  access_denied: "La connexion avec Google a été annulée ou refusée. Réessayez.",
  // Liaison Google ↔ compte e-mail existant refusée (ACCOUNT_LINKING_OPTIONS).
  account_not_linked: "Un compte existe déjà avec cette adresse. Connectez-vous avec votre e-mail et votre mot de passe.",
  email_not_found: "Google n'a pas transmis d'adresse e-mail. Créez un compte avec votre adresse et un mot de passe.",
  // Domaine refusé par ALLOWED_EMAIL_DOMAINS (databaseHooks.user.create.before).
  EMAIL_DOMAIN_NOT_ALLOWED: EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE,
  // Lien de confirmation d'adresse (verify-email) expiré, altéré ou déjà inutile.
  TOKEN_EXPIRED: EXPIRED_VERIFICATION,
  INVALID_TOKEN: EXPIRED_VERIFICATION,
  USER_NOT_FOUND: EXPIRED_VERIFICATION,
};

const FALLBACK = "La connexion avec Google a échoué. Réessayez dans un instant.";

export function oauthErrorMessage(raw: string | string[] | undefined): string | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK;
}
