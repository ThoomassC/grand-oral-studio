import { APIError } from "better-auth/api";
import { EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE } from "@/components/auth/oauth-error";
import { ProfileNameSchema } from "@/components/profile/schema";

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

export type GoogleButtonState = "enabled" | "unconfigured" | "hidden";

/**
 * Affichage du bouton Google : actif s'il est configuré ; en développement,
 * visible mais inactif pour signaler qu'il reste à configurer ; masqué en
 * production plutôt que d'afficher un bouton inutilisable.
 */
export function googleButtonState(env: Record<string, string | undefined>): GoogleButtonState {
  if (isGoogleSignInEnabled(env)) return "enabled";
  return env.NODE_ENV === "production" ? "hidden" : "unconfigured";
}

/**
 * Liaison d'un compte Google à un compte e-mail/mot de passe de même adresse :
 * seulement si l'adresse du compte local a été VÉRIFIÉE.
 *
 * - Pas de `trustedProviders` : dans Better Auth 1.7 (oauth2/link-account),
 *   un fournisseur « de confiance » est lié MÊME si son `email_verified` est faux.
 * - `requireLocalEmailVerified` laissé à son défaut (true) : le compte local doit
 *   avoir une adresse vérifiée. Sans e-mails (RESEND_API_KEY absent), aucune
 *   adresse n'est jamais vérifiée, donc la liaison est toujours refusée. Sinon,
 *   un tiers ayant inscrit d'avance l'adresse de la victime avec SON mot de
 *   passe récupérerait l'identité Google de celle-ci. Better Auth redirige alors
 *   vers `errorCallbackURL?error=account_not_linked`.
 */
export const ACCOUNT_LINKING_OPTIONS = {
  enabled: true,
  allowDifferentEmails: false,
} as const;

/**
 * Points d'entrée HTTP de Better Auth fermés (404). Les appels serveur
 * (`auth.api.*`) ne passent pas par ce filtre :
 * - `/link-social` : la liaison explicite n'est pas proposée par l'interface ;
 * - `/update-user` : Better Auth n'y borne pas le nom ; l'app passe par l'action
 *   serveur de /profil, validée par zod, qui appelle `auth.api.updateUser` ;
 * - `/delete-user` (+ `/callback`) : la suppression passe par l'action serveur de
 *   /profil, qui exige l'adresse e-mail recopiée avant d'appeler
 *   `auth.api.deleteUser` ;
 * - `/send-verification-email` : renvoi libre d'un e-mail à n'importe quelle
 *   adresse non vérifiée ; l'app le renvoie à la connexion (`sendOnSignIn`),
 *   c'est-à-dire seulement à qui connaît le mot de passe.
 *
 * Restent ouverts pour l'interface : /request-password-reset, /reset-password
 * (+ /:token), /verify-email, /change-password.
 */
export const DISABLED_AUTH_PATHS = [
  "/link-social",
  "/update-user",
  "/delete-user",
  "/delete-user/callback",
  "/send-verification-email",
];

export interface EmailDeliveryConfig {
  apiKey: string;
  /** Expéditeur Resend : « adresse » ou « Nom <adresse> ». */
  from: string;
}

const FROM_ADDRESS = /^(?:[^<>]*<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/;

/**
 * Envoi d'e-mails (Resend) : actif seulement si RESEND_API_KEY ET EMAIL_FROM
 * sont définis. Il conditionne la vérification des adresses à l'inscription et
 * la réinitialisation du mot de passe. Une configuration à moitié remplie est
 * une erreur de déploiement : on échoue au démarrage (jamais en citant la clé).
 */
export function emailDeliveryConfig(env: Record<string, string | undefined>): EmailDeliveryConfig | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey && !from) return undefined;
  if (!apiKey) throw new Error("EMAIL_FROM est défini mais RESEND_API_KEY manque : renseignez les deux ou aucun.");
  if (!from) throw new Error("RESEND_API_KEY est défini mais EMAIL_FROM manque : renseignez les deux ou aucun.");
  if (!FROM_ADDRESS.test(from)) {
    throw new Error("EMAIL_FROM invalide : une adresse (noreply@exemple.fr) ou « Nom <noreply@exemple.fr> ».");
  }
  return { apiKey, from };
}

/** Booléen exposable au client (Server Component → props) : aucun secret ne sort. */
export function isEmailDeliveryEnabled(env: Record<string, string | undefined>): boolean {
  return emailDeliveryConfig(env) !== undefined;
}

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Domaines d'adresse autorisés à créer un compte (ALLOWED_EMAIL_DOMAINS, liste
 * séparée par des virgules, ex. « lycee-exemple.fr, ac-paris.fr »). Absent ou
 * vide : aucune restriction. Domaine exact, sans sous-domaine implicite.
 */
export function allowedEmailDomains(env: Record<string, string | undefined>): string[] | undefined {
  const entries = (env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  for (const domain of entries) {
    if (!DOMAIN.test(domain)) {
      throw new Error(`ALLOWED_EMAIL_DOMAINS invalide : « ${domain} » n'est pas un nom de domaine (ex. lycee-exemple.fr).`);
    }
  }
  return [...new Set(entries)];
}

/** L'adresse appartient-elle à un domaine autorisé ? (comparaison en minuscules, domaine exact) */
export function isEmailDomainAllowed(email: string, domains: readonly string[] | undefined): boolean {
  if (!domains) return true;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return domains.includes(email.slice(at + 1).trim().toLowerCase());
}

/**
 * Avertissement de démarrage : sans e-mails, aucune adresse n'est vérifiée, donc
 * ALLOWED_EMAIL_DOMAINS filtre une adresse DÉCLARÉE, pas une boîte possédée
 * (n'importe qui peut s'inscrire avec prenom.nom@lycee-exemple.fr). Pas de refus
 * au démarrage : la restriction garde un intérêt (pas d'inscription par erreur).
 */
export function domainRestrictionWarning(env: Record<string, string | undefined>): string | undefined {
  if (!allowedEmailDomains(env) || isEmailDeliveryEnabled(env)) return undefined;
  return "ALLOWED_EMAIL_DOMAINS est défini sans e-mails : sans vérification d'adresse (RESEND), la restriction de domaine ne prouve pas la possession de la boîte.";
}

/** Caractères de contrôle (sauts de ligne compris) et séparateurs de ligne Unicode. */
const NAME_CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u;
const NAME_CONTROL_MESSAGE = "Le nom ne doit contenir ni saut de ligne ni caractère de contrôle.";

/**
 * Garde de l'inscription par e-mail (hooks.before de Better Auth, toujours actif) :
 *  1. domaine d'adresse (ALLOWED_EMAIL_DOMAINS) : refus explicite AVANT le point
 *     d'entrée. Quand la vérification est active, Better Auth convertit un refus du
 *     hook de création en fausse réussite (anti-énumération) : l'utilisateur
 *     attendrait un e-mail qui ne partira jamais. Le domaine n'est pas une donnée
 *     personnelle ;
 *  2. nom : Better Auth l'accepte sans borne. Même règle que /profil
 *     (ProfileNameSchema, 2 à 80 caractères), sans caractère de contrôle : il
 *     finit dans l'objet et le corps des e-mails envoyés à des collègues.
 *
 * Renvoie le corps à transmettre (nom normalisé) pour /sign-up/email, rien pour
 * les autres chemins. Lève une APIError (FORBIDDEN, BAD_REQUEST) en cas de refus.
 */
export function signUpGuard(
  path: string,
  body: unknown,
  allowedDomains: readonly string[] | undefined,
): Record<string, unknown> | undefined {
  if (path !== "/sign-up/email") return undefined;
  const fields: Record<string, unknown> = typeof body === "object" && body !== null ? { ...(body as Record<string, unknown>) } : {};
  if (typeof fields.email === "string" && !isEmailDomainAllowed(fields.email, allowedDomains)) {
    // Le code devient `?error=EMAIL_DOMAIN_NOT_ALLOWED` au retour de Google (oauth-error.ts).
    throw emailDomainNotAllowedError();
  }
  if (typeof fields.name === "string" && NAME_CONTROL_CHARS.test(fields.name)) throw invalidName(NAME_CONTROL_MESSAGE);
  const parsed = ProfileNameSchema.safeParse({ name: fields.name });
  if (!parsed.success) throw invalidName(parsed.error.issues[0]?.message ?? "Indiquez votre nom.");
  return { ...fields, name: parsed.data.name };
}

/** Refus d'un domaine d'adresse non autorisé (inscription par e-mail ou par Google). */
export function emailDomainNotAllowedError(): APIError {
  return new APIError("FORBIDDEN", { code: "EMAIL_DOMAIN_NOT_ALLOWED", message: EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE });
}

function invalidName(message: string): APIError {
  return new APIError("BAD_REQUEST", { code: "INVALID_NAME", message });
}
