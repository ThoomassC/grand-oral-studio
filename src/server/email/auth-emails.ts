import { createHash } from "node:crypto";
import { after } from "next/server";
import { createLogger } from "../logger";
import { sendEmail, type EmailMessage, type ResendConfig } from "./resend";
import { resetPasswordEmail, verificationEmail } from "./templates";

/**
 * E-mails envoyés par Better Auth (confirmation d'adresse, réinitialisation du
 * mot de passe).
 *
 * Les callbacks rendent la main immédiatement : l'envoi part APRÈS la réponse
 * HTTP (`after` de Next), si bien que
 * - la réponse ne dépend pas de la latence de Resend ;
 * - « mot de passe oublié » répond dans le même temps que l'adresse existe ou
 *   non (Better Auth attend sinon l'envoi dans le seul cas « existe »).
 * Hors contexte de requête (`after` indisponible), l'envoi part sans être
 * attendu. Un échec est journalisé par `sendEmail`, jamais remonté.
 */

type Task = () => Promise<unknown>;

export function runAfterResponse(task: Task): void {
  try {
    after(task);
  } catch {
    void task().catch(() => {});
  }
}

/** Clé d'idempotence dérivée du jeton (le jeton lui-même ne part pas en en-tête). */
function idempotencyKey(kind: string, token: string): string {
  return `${kind}:${createHash("sha256").update(token).digest("hex").slice(0, 40)}`;
}

interface AuthEmailUser {
  email: string;
  name: string;
}

export interface AuthEmailDeps {
  send?: (message: EmailMessage, kind: string) => Promise<unknown>;
  schedule?: (task: Task) => void;
}

export function createAuthEmails(config: ResendConfig, deps: AuthEmailDeps = {}) {
  // Un identifiant de corrélation par envoi (toutes ses tentatives).
  const send =
    deps.send ??
    ((message: EmailMessage, kind: string) => sendEmail(config, message, { log: createLogger({ scope: "auth-email" }), kind }));
  const schedule = deps.schedule ?? runAfterResponse;

  function deliver(kind: string, user: AuthEmailUser, token: string, rendered: { subject: string; text: string; html: string }) {
    schedule(() => send({ to: user.email, ...rendered, idempotencyKey: idempotencyKey(kind, token) }, kind));
  }

  return {
    async sendVerificationEmail({ user, url, token }: { user: AuthEmailUser; url: string; token: string }): Promise<void> {
      deliver("verification", user, token, verificationEmail({ name: user.name, url }));
    },
    async sendResetPassword({ user, url, token }: { user: AuthEmailUser; url: string; token: string }): Promise<void> {
      deliver("reset-password", user, token, resetPasswordEmail({ name: user.name, url }));
    },
  };
}
