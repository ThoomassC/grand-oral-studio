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
