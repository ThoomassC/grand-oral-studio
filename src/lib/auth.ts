import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE } from "@/components/auth/oauth-error";
import { db } from "@/server/db/client";
import { createAuthEmails } from "@/server/email/auth-emails";
import {
  ACCOUNT_LINKING_OPTIONS,
  allowedEmailDomains,
  DISABLED_AUTH_PATHS,
  emailDeliveryConfig,
  googleProviderOptions,
  ipAddressOptions,
  isEmailDomainAllowed,
  SESSION_OPTIONS,
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
 */

const secret = process.env.BETTER_AUTH_SECRET;
if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
  throw new Error("BETTER_AUTH_SECRET manquant ou trop court (32 caractères minimum).");
}

const google = googleProviderOptions(process.env);
const email = emailDeliveryConfig(process.env);
const authEmails = email ? createAuthEmails(email) : undefined;
const allowedDomains = allowedEmailDomains(process.env);

function domainNotAllowed(): APIError {
  // Le code devient `?error=EMAIL_DOMAIN_NOT_ALLOWED` au retour de Google (oauth-error.ts).
  return new APIError("FORBIDDEN", { code: "EMAIL_DOMAIN_NOT_ALLOWED", message: EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE });
}

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
              if (!isEmailDomainAllowed(user.email, allowedDomains)) throw domainNotAllowed();
            },
          },
        },
      }
    : undefined,
  hooks: allowedDomains
    ? {
        // Inscription par e-mail : refus explicite AVANT le point d'entrée. Quand la
        // vérification est active, Better Auth convertit un refus du hook de création
        // en fausse réussite (anti-énumération) : l'utilisateur attendrait un e-mail
        // qui ne partira jamais. Le domaine n'est pas une donnée personnelle.
        before: createAuthMiddleware(async (ctx) => {
          if (ctx.path !== "/sign-up/email") return;
          const address: unknown = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof address === "string" && !isEmailDomainAllowed(address, allowedDomains)) throw domainNotAllowed();
        }),
      }
    : undefined,
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
