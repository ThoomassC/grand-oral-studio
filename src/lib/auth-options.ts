/**
 * Options Better Auth dérivées de l'environnement — fonctions pures, testables
 * sans base ni Next.
 */

/** Session de 30 jours glissants : prolongée au plus une fois par jour d'activité. */
export const SESSION_OPTIONS = {
  expiresIn: 60 * 60 * 24 * 30,
  updateAge: 60 * 60 * 24,
} as const;

const HEADER_NAME = /^[a-z0-9-]+$/;

/**
 * En-tête d'IP client à croire (limitation de débit, journal des sessions).
 *
 * Derrière un reverse proxy, seul l'en-tête qu'il pose lui-même est fiable
 * (`x-real-ip` pour nginx, `cf-connecting-ip` pour Cloudflare…) : un
 * `x-forwarded-for` envoyé par le client serait sinon pris au pied de la lettre
 * et permettrait de contourner la limitation de débit en changeant d'IP à
 * chaque requête. Sans TRUSTED_IP_HEADER, comportement par défaut de Better Auth.
 */
export function ipAddressOptions(env: Record<string, string | undefined>): { ipAddressHeaders: string[] } | undefined {
  const raw = env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (!raw) return undefined;
  if (!HEADER_NAME.test(raw)) {
    throw new Error(`TRUSTED_IP_HEADER invalide : « ${raw} » (un seul nom d'en-tête, ex. x-real-ip).`);
  }
  return { ipAddressHeaders: [raw] };
}

export interface GoogleProviderOptions {
  clientId: string;
  clientSecret: string;
  prompt: "select_account";
}

/**
 * Connexion Google : activée seulement si l'ID client ET le secret sont
 * définis. Scopes par défaut de Better Auth (openid, email, profile), rien de
 * plus. Une configuration à moitié remplie est une erreur de déploiement : on
 * échoue au démarrage plutôt que d'afficher un bouton qui ne marcherait pas.
 */
export function googleProviderOptions(env: Record<string, string | undefined>): GoogleProviderOptions | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return undefined;
  if (!clientId) throw new Error("GOOGLE_CLIENT_SECRET est défini mais GOOGLE_CLIENT_ID manque : renseignez les deux ou aucun.");
  if (!clientSecret) throw new Error("GOOGLE_CLIENT_ID est défini mais GOOGLE_CLIENT_SECRET manque : renseignez les deux ou aucun.");
  // select_account : laisse choisir le compte Google quand plusieurs sont ouverts.
  return { clientId, clientSecret, prompt: "select_account" };
}

/** Booléen exposable au client (Server Component → props) : aucun secret ne sort. */
export function isGoogleSignInEnabled(env: Record<string, string | undefined>): boolean {
  return googleProviderOptions(env) !== undefined;
}

/**
 * Liaison d'un compte Google à un compte e-mail/mot de passe de même adresse :
 * REFUSÉE tant que l'app ne vérifie pas les adresses à l'inscription.
 *
 * - Pas de `trustedProviders` : dans Better Auth 1.7 (oauth2/link-account),
 *   un fournisseur « de confiance » est lié MÊME si son `email_verified` est faux.
 * - `requireLocalEmailVerified` laissé à son défaut (true) : le compte local doit
 *   avoir une adresse vérifiée, ce qui n'arrive jamais en v1. Sinon, un tiers
 *   ayant inscrit d'avance l'adresse de la victime avec SON mot de passe
 *   récupérerait l'identité Google de celle-ci. Better Auth redirige alors vers
 *   `errorCallbackURL?error=account_not_linked`.
 */
export const ACCOUNT_LINKING_OPTIONS = {
  enabled: true,
  allowDifferentEmails: false,
} as const;

/** Points d'entrée Better Auth fermés (404) : la liaison explicite n'est pas proposée par l'interface. */
export const DISABLED_AUTH_PATHS = ["/link-social"];
