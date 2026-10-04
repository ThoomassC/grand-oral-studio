import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import {
  ACCOUNT_LINKING_OPTIONS,
  DISABLED_AUTH_PATHS,
  googleProviderOptions,
  ipAddressOptions,
  SESSION_OPTIONS,
} from "./auth-options";

/**
 * Better Auth (serveur) : e-mail + mot de passe, sessions en base (tables
 * user/session/account/verification du schéma Prisma), limitation de débit
 * persistée en base (table rateLimit) pour tenir sur plusieurs instances.
 * Pas de vérification d'e-mail en v1. Connexion Google optionnelle
 * (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) ; jamais liée à un compte
 * e-mail/mot de passe existant (voir ACCOUNT_LINKING_OPTIONS).
 */

const secret = process.env.BETTER_AUTH_SECRET;
if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
  throw new Error("BETTER_AUTH_SECRET manquant ou trop court (32 caractères minimum).");
}

const google = googleProviderOptions(process.env);

export const auth = betterAuth({
  appName: "Grand Oral Studio",
  secret,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db(), { provider: "postgresql", transaction: true }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
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
    },
  },
  advanced: {
    ipAddress: ipAddressOptions(process.env),
  },
  // nextCookies doit rester le dernier plugin (pose les cookies depuis les Server Actions).
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
