import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import { ipAddressOptions, SESSION_OPTIONS } from "./auth-options";

/**
 * Better Auth (serveur) : e-mail + mot de passe, sessions en base (tables
 * user/session/account/verification du schéma Prisma), limitation de débit
 * persistée en base (table rateLimit) pour tenir sur plusieurs instances.
 * Pas de vérification d'e-mail en v1.
 */

const secret = process.env.BETTER_AUTH_SECRET;
if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
  throw new Error("BETTER_AUTH_SECRET manquant ou trop court (32 caractères minimum).");
}

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
