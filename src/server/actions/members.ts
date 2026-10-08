"use server";

import { InviteMemberSchema, MemberRoleSchema, type InviteMemberInput } from "@/components/projects/share-schema";
import { emailDeliveryConfig } from "@/lib/auth-options";
import { runAfterResponse } from "../email/auth-emails";
import { memberAddedEmail, projectUrl } from "../email/member-added";
import { sendEmail } from "../email/resend";
import { AppError, RateLimitedError } from "../errors";
import type { Logger } from "../logger";
import { consumeQuota, type QuotaPolicy } from "../rate-limit";
import * as repo from "../repo/members";
import type { InvitedMember, MemberView } from "../repo/members";
import { IdSchema, parseInput } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

/**
 * Partage d'un projet : couche de transport fine au-dessus de ../repo/members.ts
 * (validation zod des entrées, session, quota, invalidation, notification).
 * L'autorisation (propriétaire / membre) est vérifiée par le dépôt, dans ses requêtes.
 */

/** Invitations par propriétaire : borne l'usage du formulaire comme annuaire d'adresses. */
const INVITE_QUOTA: QuotaPolicy = { limit: 30, windowSeconds: 3600 };

/** Quota d'invitations atteint (message propre : RateLimitedError parle de générations). */
class InviteRateLimitedError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;
  constructor(retryAfterSeconds: number) {
    super(`Trop d'invitations en peu de temps. Réessayez dans ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} min.`);
  }
}

async function consumeInviteQuota(userId: string): Promise<void> {
  try {
    await consumeQuota(`invite:${userId}`, 1, INVITE_QUOTA, "user");
  } catch (error) {
    if (error instanceof RateLimitedError) throw new InviteRateLimitedError(error.retryAfterSeconds);
    throw error;
  }
}

/**
 * Prévient le nouveau membre, APRÈS le commit et après la réponse (non bloquant).
 * Rien si les e-mails ne sont pas configurés ou si BETTER_AUTH_URL manque. Un échec
 * est journalisé par sendEmail, jamais remonté : l'ajout est fait, l'e-mail est un bonus.
 */
function notifyMemberAdded(invited: InvitedMember, programId: string, inviterName: string, log: Logger): void {
  let config: ReturnType<typeof emailDeliveryConfig>;
  try {
    config = emailDeliveryConfig(process.env);
  } catch {
    // Configuration à moitié remplie : déjà refusée au démarrage par src/lib/auth.ts.
    log.warn("member.notify_skipped", { reason: "email_config_invalid" });
    return;
  }
  if (!config) return;
  const url = projectUrl(process.env.BETTER_AUTH_URL, programId);
  if (!url) {
    log.warn("member.notify_skipped", { reason: "base_url_missing" });
    return;
  }
  const message = memberAddedEmail({
    recipientName: invited.member.name,
    inviterName,
    programName: invited.programName,
    role: invited.member.role,
    url,
  });
  const mailer = config;
  runAfterResponse(() =>
    sendEmail(
      mailer,
      // Idempotence : un ajout = une ligne (projet, membre, date d'ajout). Aucune donnée personnelle dans la clé.
      { to: invited.member.email, ...message, idempotencyKey: `member-added:${programId}:${invited.member.userId}:${invited.member.addedAt}` },
      { log, kind: "member-added" },
    ),
  );
}

export async function inviteMember(programId: string, input: InviteMemberInput): Promise<ActionResult<{ member: MemberView }>> {
  return runAction("inviteMember", async ({ user, log }) => {
    const id = parseInput(IdSchema, programId);
    const { email, role } = parseInput(InviteMemberSchema, input);
    await consumeInviteQuota(user.id);
    const invited = await repo.inviteMember(user.id, id, email, role);
    revalidatePrograms(id);
    notifyMemberAdded(invited, id, user.name, log.child({ programId: id }));
    return { member: invited.member };
  });
}

export async function changeMemberRole(programId: string, memberUserId: string, role: string): Promise<ActionResult<null>> {
  return runAction("changeMemberRole", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const memberId = parseInput(IdSchema, memberUserId);
    const value = parseInput(MemberRoleSchema, role);
    await repo.changeRole(user.id, id, memberId, value);
    revalidatePrograms(id);
    return null;
  });
}

export async function removeMember(programId: string, memberUserId: string): Promise<ActionResult<{ removed: boolean }>> {
  return runAction("removeMember", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const memberId = parseInput(IdSchema, memberUserId);
    const result = await repo.removeMember(user.id, id, memberId);
    revalidatePrograms(id);
    return result;
  });
}

export async function leaveProject(programId: string): Promise<ActionResult<null>> {
  return runAction("leaveProject", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    await repo.leaveProject(user.id, id);
    revalidatePrograms(id);
    return null;
  });
}
