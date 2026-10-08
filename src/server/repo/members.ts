import { isEmailDeliveryEnabled } from "@/lib/auth-options";
import { db } from "../db/client";
import { ConflictError, LimitExceededError, NotFoundError, ValidationError } from "../errors";
import { lockProgramFor, memberRole, programAccess, roleOf, type MemberRole, type ProgramRole } from "./access";
import { prismaErrorCode } from "./ownership";

/**
 * Membres d'un projet partagé (v1.2). Règles (cf. ./access.ts) :
 *  - le propriétaire est `Program.ownerId`, jamais une ligne ProgramMember ; une
 *    ligne parasite du propriétaire est ignorée partout (liste, plafond, gestion) ;
 *  - lire la liste : lecteur et plus ; inviter, changer un rôle, retirer : propriétaire ;
 *  - les adresses e-mail (propriétaire et membres) ne sont renvoyées qu'au
 *    propriétaire : éditeurs et lecteurs voient noms et rôles, `email` vaut null ;
 *  - un membre (éditeur ou lecteur) peut se retirer lui-même (`leaveProject`) ;
 *  - chaque écriture verrouille d'abord la ligne du projet (lockProgramFor, sous
 *    condition d'accès) : les invitations concurrentes sont sérialisées, le plafond
 *    de membres et l'absence de doublon tiennent sous charge.
 *
 * Invitation : seuls les comptes EXISTANTS peuvent être ajoutés (pas d'invitation
 * en attente). Le message « aucun compte n'utilise cette adresse » révèle donc au
 * propriétaire d'un projet si une adresse a un compte sur l'instance. Choix assumé
 * pour une instance d'équipe (les collègues se connaissent) ; la route est
 * réservée au propriétaire et limitée en débit (quota `invite:<userId>`) pour
 * qu'elle ne serve pas d'annuaire. Les adresses sont stockées en minuscules par
 * Better Auth : la recherche par adresse minuscule passe par l'index unique.
 *
 * Preuve d'identité : quand les e-mails sont actifs, seul un compte dont l'adresse
 * est CONFIRMÉE peut être ajouté (sinon un tiers ayant inscrit d'avance l'adresse
 * d'un collègue recevrait l'accès à sa place). Sans e-mails, aucune adresse n'est
 * jamais confirmée : l'invitation reste possible et l'interface prévient le
 * propriétaire que l'adresse ne prouve pas l'identité.
 */

export const MAX_MEMBERS_PER_PROGRAM = 20;

/** Plafond de lecture de la liste (le plafond métier est MAX_MEMBERS_PER_PROGRAM). */
const LIST_LIMIT = 100;

export const UNKNOWN_ACCOUNT_MESSAGE = "Aucun compte n'utilise cette adresse : votre collègue doit d'abord créer son compte.";
export const UNVERIFIED_ACCOUNT_MESSAGE =
  "Ce compte n'a pas encore confirmé son adresse e-mail. Votre collègue reçoit le lien de confirmation à sa prochaine connexion.";
const SELF_INVITE_MESSAGE = "Vous êtes le propriétaire de ce projet : vous y avez déjà tous les droits.";
const ALREADY_MEMBER_MESSAGE = "Cette personne est déjà membre du projet.";
const NOT_A_MEMBER_MESSAGE = "Cette personne n'est plus membre du projet. Rechargez la page.";
const OWNER_UNTOUCHABLE_MESSAGE = "Le rôle du propriétaire ne se modifie pas.";
const OWNER_CANNOT_LEAVE_MESSAGE =
  "Vous êtes le propriétaire de ce projet : vous ne pouvez pas le quitter. Supprimez-le si vous n'en avez plus besoin.";

/** Rôle applicatif → valeur stockée (CHECK ProgramMember_role_known). */
const STORED_ROLE: Record<MemberRole, "EDITOR" | "VIEWER"> = { editor: "EDITOR", viewer: "VIEWER" };

export interface MemberView {
  userId: string;
  name: string;
  /** Adresse e-mail : renseignée pour le seul propriétaire du projet, null sinon. */
  email: string | null;
  role: MemberRole;
  /** Date d'ajout (ISO). */
  addedAt: string;
}

export interface ProgramMembers {
  programId: string;
  /** Rôle de l'appelant sur le projet. */
  myRole: ProgramRole;
  /** `email` : renseigné pour le seul propriétaire du projet, null sinon. */
  owner: { userId: string; name: string; email: string | null };
  /** Membres invités, du plus ancien au plus récent (propriétaire exclu). */
  members: MemberView[];
}

export interface InvitedMember {
  /** L'appelant est le propriétaire : l'adresse est toujours connue (destinataire de la notification). */
  member: MemberView & { email: string };
  /** Nom du projet (pour la notification). */
  programName: string;
}

/**
 * Propriétaire et membres d'un projet actif, pour tout membre (lecteur et plus).
 * Adresses e-mail réservées au propriétaire (null pour un éditeur ou un lecteur).
 * Absent, étranger ou à la corbeille → NotFoundError.
 */
export async function listMembers(userId: string, programId: string): Promise<ProgramMembers> {
  const row = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "viewer") },
    select: {
      ownerId: true,
      owner: { select: { name: true, email: true } },
      members: {
        orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        take: LIST_LIMIT,
        select: { userId: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!row) throw new NotFoundError("programme");
  const myRole = roleOf(userId, row.ownerId, row.members.find((m) => m.userId === userId)?.role);
  if (!myRole) throw new NotFoundError("programme");
  // Confidentialité : un éditeur ou un lecteur ne reçoit aucune adresse, pas même la sienne.
  const emailOf = (email: string): string | null => (myRole === "owner" ? email : null);

  const members = row.members.flatMap((m): MemberView[] => {
    const role = memberRole(m.role);
    // Ligne parasite du propriétaire, ou rôle inconnu : ignorée.
    if (m.userId === row.ownerId || !role) return [];
    return [{ userId: m.userId, name: m.user.name, email: emailOf(m.user.email), role, addedAt: m.createdAt.toISOString() }];
  });
  return {
    programId,
    myRole,
    owner: { userId: row.ownerId, name: row.owner.name, email: emailOf(row.owner.email) },
    members,
  };
}

/**
 * Ajoute le compte d'adresse `email` au projet (propriétaire seul), avec `role`.
 * Refus : adresse sans compte, le propriétaire lui-même, adresse non confirmée
 * quand les e-mails sont actifs (ValidationError), déjà
 * membre (ConflictError, rôle inchangé), plafond atteint (LimitExceededError).
 */
export async function inviteMember(ownerId: string, programId: string, email: string, role: MemberRole): Promise<InvitedMember> {
  const address = email.trim().toLowerCase();
  const requireVerifiedEmail = isEmailDeliveryEnabled(process.env);
  try {
    return await db().$transaction(async (tx) => {
      await lockProgramFor(tx, ownerId, programId, "owner");
      // Requêtes successives : une transaction interactive n'a qu'une connexion.
      const program = await tx.program.findUniqueOrThrow({ where: { id: programId }, select: { name: true } });
      const target = await tx.user.findUnique({ where: { email: address }, select: { id: true, name: true, email: true, emailVerified: true } });
      if (!target) throw new ValidationError(UNKNOWN_ACCOUNT_MESSAGE, { email: [UNKNOWN_ACCOUNT_MESSAGE] });
      if (target.id === ownerId) throw new ValidationError(SELF_INVITE_MESSAGE, { email: [SELF_INVITE_MESSAGE] });
      if (requireVerifiedEmail && !target.emailVerified) {
        throw new ValidationError(UNVERIFIED_ACCOUNT_MESSAGE, { email: [UNVERIFIED_ACCOUNT_MESSAGE] });
      }

      const existing = await tx.programMember.findUnique({
        where: { programId_userId: { programId, userId: target.id } },
        select: { userId: true },
      });
      if (existing) throw new ConflictError(ALREADY_MEMBER_MESSAGE);

      const count = await tx.programMember.count({ where: { programId, userId: { not: ownerId } } });
      if (count >= MAX_MEMBERS_PER_PROGRAM) {
        throw new LimitExceededError(
          `Un projet est partagé avec ${MAX_MEMBERS_PER_PROGRAM} personnes au plus. Retirez un membre avant d'en ajouter un autre.`,
        );
      }

      const created = await tx.programMember.create({
        data: { programId, userId: target.id, role: STORED_ROLE[role] },
        select: { createdAt: true },
      });
      return {
        programName: program.name,
        member: { userId: target.id, name: target.name, email: target.email, role, addedAt: created.createdAt.toISOString() },
      };
    });
  } catch (error) {
    // Filet : la ligne du projet est verrouillée, mais la clé primaire reste l'arbitre.
    if (prismaErrorCode(error) === "P2002") throw new ConflictError(ALREADY_MEMBER_MESSAGE);
    throw error;
  }
}

/** Change le rôle d'un membre (propriétaire seul). Personne absente de la liste → ConflictError. */
export async function changeRole(ownerId: string, programId: string, memberUserId: string, role: MemberRole): Promise<void> {
  await db().$transaction(async (tx) => {
    await lockProgramFor(tx, ownerId, programId, "owner");
    if (memberUserId === ownerId) throw new ValidationError(OWNER_UNTOUCHABLE_MESSAGE);
    const { count } = await tx.programMember.updateMany({
      where: { programId, userId: memberUserId },
      data: { role: STORED_ROLE[role] },
    });
    if (count === 0) throw new ConflictError(NOT_A_MEMBER_MESSAGE);
  });
}

/**
 * Retire un membre (propriétaire seul). Idempotent : retirer quelqu'un qui ne l'est
 * plus renvoie `{ removed: false }` (double clic, onglet périmé).
 */
export async function removeMember(ownerId: string, programId: string, memberUserId: string): Promise<{ removed: boolean }> {
  return db().$transaction(async (tx) => {
    await lockProgramFor(tx, ownerId, programId, "owner");
    if (memberUserId === ownerId) throw new ValidationError(OWNER_UNTOUCHABLE_MESSAGE);
    const { count } = await tx.programMember.deleteMany({ where: { programId, userId: memberUserId } });
    return { removed: count > 0 };
  });
}

/**
 * Le membre `userId` se retire du projet. Le propriétaire ne peut pas « quitter »
 * (ValidationError) ; un non-membre, ou un projet à la corbeille → NotFoundError
 * (y compris après un premier retrait réussi : il n'a plus accès au projet).
 */
export async function leaveProject(userId: string, programId: string): Promise<void> {
  await db().$transaction(async (tx) => {
    const role = await lockProgramFor(tx, userId, programId, "viewer");
    if (role === "owner") throw new ValidationError(OWNER_CANNOT_LEAVE_MESSAGE);
    await tx.programMember.deleteMany({ where: { programId, userId } });
  });
}

/**
 * Nombre de projets ACTIFS possédés par `userId` et partagés avec au moins un
 * membre (ligne parasite du propriétaire exclue). Sert à prévenir, avant la
 * suppression du compte, que ces projets disparaîtront aussi pour les collègues.
 * Index Program(ownerId, updatedAt) puis clé primaire de ProgramMember.
 */
export async function countSharedOwnedPrograms(userId: string): Promise<number> {
  const rows = await db().$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS "count"
    FROM "Program" p
    WHERE p."ownerId" = ${userId}
      AND p."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "ProgramMember" m
        WHERE m."programId" = p."id" AND m."userId" <> p."ownerId")`;
  return rows[0]?.count ?? 0;
}
