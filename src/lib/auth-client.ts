import { createAuthClient } from "better-auth/react";

/**
 * Client Better Auth pour les composants React. Même origine que l'app : pas de
 * baseURL à configurer (les appels vont vers /api/auth/*).
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
