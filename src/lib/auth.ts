import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import { createAuthEmails } from "@/server/email/auth-emails";
import { createLogger } from "@/server/logger";
import {
  ACCOUNT_LINKING_OPTIONS,
  allowedEmailDomains,
  DISABLED_AUTH_PATHS,
  domainRestrictionWarning,
  emailDeliveryConfig,
  emailDomainNotAllowedError,
  googleProviderOptions,
  ipAddressOptions,
  isEmailDomainAllowed,
  SESSION_OPTIONS,
  signUpGuard,
} from "./auth-options";

/**
 * Better Auth (serveur) : e-mail + mot de passe, sessions en base (tables
 * user/session/account/verification du schéma Prisma), limitation de débit
 * persistée en base (table rateLimit) pour tenir sur plusieurs instances.
 * Connexion Google optionnelle (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) ; liée
 * à un compte e-mail/mot de passe seulement si son adresse est vérifiée (voir
 * ACCOUNT_LINKING_OPTIONS).
 *
 * E-mails (RESEND_API_KEY + EMAIL_FROM) : s'ils sont configurés, l'adresse doit
 * être confirmée avant la première connexion (lien renvoyé à chaque connexion
 * tant qu'elle ne l'est pas, y compris pour les comptes créés avant), et le mot
 * de passe oublié se réinitialise par e-mail. Sans eux : aucune vérification,
 * comportement de la v1.1.
 *
 * ALLOWED_EMAIL_DOMAINS (facultatif) : seuls ces domaines peuvent créer un
 * compte, par e-mail comme par Google. Les comptes existants ne sont pas touchés.
 * Sans e-mails, l'adresse n'est pas vérifiée : la restriction filtre une adresse
 * déclarée, pas une boîte possédée (avertissement au démarrage).
 */

const secret = process.env.BETTER_AUTH_SECRET;
if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
  throw new Error("BETTER_AUTH_SECRET manquant ou trop court (32 caractères minimum).");
}

const google = googleProviderOptions(process.env);
const email = emailDeliveryConfig(process.env);
const authEmails = email ? createAuthEmails(email) : undefined;
const allowedDomains = allowedEmailDomains(process.env);

const domainWarning = domainRestrictionWarning(process.env);
if (domainWarning) createLogger({ scope: "auth" }).warn("auth.config.domain_restriction_unverified", { message: domainWarning });

export const auth = betterAuth({
  appName: "Grand Oral Studio",
  secret,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db(), { provider: "postgresql", transaction: true }),
  emailAndPassword: {
    enabled: true,
    // Comptes existants (emailVerified = false) : pas de rétro-remplissage, le
    // lien leur est envoyé à la prochaine connexion (sendOnSignIn).
    requireEmailVerification: Boolean(authEmails),
    minPasswordLength: 10,
    maxPasswordLength: 128,
    // Sans effet quand la vérification est exigée (pas de session avant confirmation).
    autoSignIn: true,
    ...(authEmails
      ? {
          sendResetPassword: authEmails.sendResetPassword,
          resetPasswordTokenExpiresIn: 60 * 60,
          // Qui réinitialise son mot de passe ferme les sessions ouvertes ailleurs.
          revokeSessionsOnPasswordReset: true,
        }
      : {}),
  },
  emailVerification: authEmails
    ? {
        sendVerificationEmail: authEmails.sendVerificationEmail,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        expiresIn: 60 * 60,
      }
    : undefined,
  user: {
    // Appelé par l'action serveur de /profil (`/delete-user` est fermé en HTTP).
    deleteUser: { enabled: true },
  },
  databaseHooks: allowedDomains
    ? {
        user: {
          create: {
            // Tout chemin de création (e-mail, Google) passe ici.
            before: async (user) => {
              if (!isEmailDomainAllowed(user.email, allowedDomains)) throw emailDomainNotAllowedError();
            },
          },
        },
      }
    : undefined,
  hooks: {
    // Inscription par e-mail : domaine autorisé et nom borné, refusés AVANT le
    // point d'entrée (voir signUpGuard) ; le nom normalisé remplace celui reçu.
    before: createAuthMiddleware(async (ctx) => {
      const body = signUpGuard(ctx.path, ctx.body, allowedDomains);
      if (body) return { context: { body } };
    }),
  },
  socialProviders: google ? { google } : undefined,
  account: { accountLinking: ACCOUNT_LINKING_OPTIONS },
  disabledPaths: DISABLED_AUTH_PATHS,
  session: SESSION_OPTIONS,
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 3600, max: 10 },
      // Chaque appel peut envoyer un e-mail : plafond bas par IP.
      "/request-password-reset": { window: 900, max: 5 },
      "/reset-password": { window: 900, max: 10 },
      // Vérifie le mot de passe actuel : pas de devinette en rafale.
      "/change-password": { window: 900, max: 10 },
    },
  },
  advanced: {
    ipAddress: ipAddressOptions(process.env),
  },
  // nextCookies doit rester le dernier plugin (pose les cookies depuis les Server Actions).
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
