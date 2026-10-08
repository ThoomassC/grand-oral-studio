import { Prisma } from "../db/generated/prisma/client";
import type { Db, Tx } from "../db/client";
import { ForbiddenError, NotFoundError } from "../errors";
import { UNDO_WINDOW_SECONDS } from "./trash";

/**
 * Contrôle d'accès par rôle sur un projet (v1.2). Règles :
 *  - le propriétaire est `Program.ownerId`, jamais une ligne ProgramMember ; une ligne
 *    membre parasite du propriétaire est ignorée (le propriétaire est prioritaire) ;
 *  - un membre a le rôle de sa ligne ProgramMember ('EDITOR' | 'VIEWER') ;
 *  - un projet ou un deck à la corbeille (`deletedAt` non nul) est invisible pour tous ;
 *  - inconnu → NotFoundError (l'existence n'est jamais révélée) ; membre au rôle
 *    insuffisant → ForbiddenError (403).
 *
 * Toute requête filtre par l'accès DANS sa clause WHERE (ou verrouille la ligne sous
 * condition d'accès) — jamais un `if` après coup sur une ligne déjà lue sans filtre.
 *
 * Matrice : lecteur = lire, exporter, répéter, imprimer, marquer une question,
 * dupliquer vers son compte ; éditeur = apparence, trame, sujets, reconnaissance,
 * génération, édition/suppression de diaporama, questions ; propriétaire = supprimer
 * ou restaurer le projet, gérer les membres.
 */

export type ProgramRole = "owner" | "editor" | "viewer";
export type MemberRole = Exclude<ProgramRole, "owner">;

const RANK: Record<ProgramRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** Vrai si `role` permet une action qui exige `min`. */
export function hasRole(role: ProgramRole, min: ProgramRole): boolean {
  return RANK[role] >= RANK[min];
}

/** Valeurs stockées dans ProgramMember.role (CHECK ProgramMember_role_known). */
const STORED_MEMBER_ROLES: Record<string, MemberRole> = { EDITOR: "editor", VIEWER: "viewer" };

/** Valeurs stockées qui satisfont au moins `min` (un membre n'est jamais propriétaire). */
const STORED_AT_LEAST: Record<MemberRole, string[]> = { editor: ["EDITOR"], viewer: ["EDITOR", "VIEWER"] };

/** Rôle stocké → rôle applicatif ; une valeur inconnue ne donne aucun droit. */
export function memberRole(stored: string | null | undefined): MemberRole | null {
  return stored ? (STORED_MEMBER_ROLES[stored] ?? null) : null;
}

/** Rôle effectif : propriétaire d'abord (ligne membre parasite ignorée), sinon la ligne membre. */
export function roleOf(userId: string, ownerId: string, storedMemberRole: string | null | undefined): ProgramRole | null {
  if (ownerId === userId) return "owner";
  return memberRole(storedMemberRole);
}

/**
 * Filtre Prisma « projet actif sur lequel `userId` a au moins `min` ». Pour une
 * lecture par clé (`{ id, ...programAccess(...) }`) : l'EXISTS sur ProgramMember
 * passe par la clé primaire (programId, userId). Pour une LISTE, préférer
 * `accessibleProgramIds` (l'OR + EXISTS fait un parcours séquentiel de Program).
 */
export function programAccess(userId: string, min: ProgramRole): Prisma.ProgramWhereInput {
  if (min === "owner") return { ownerId: userId, deletedAt: null };
  return {
    deletedAt: null,
    OR: [{ ownerId: userId }, { members: { some: { userId, role: { in: STORED_AT_LEAST[min] } } } }],
  };
}

/** Filtre « deck hors corbeille ». */
export const liveDeck = { deletedAt: null } as const satisfies Prisma.DeckWhereInput;

/** Sélection de la ligne membre de `userId` (au plus une : PK (programId, userId)). */
export const memberRoleOf = (userId: string) =>
  ({ where: { userId }, select: { role: true }, take: 1 }) satisfies Prisma.Program$membersArgs;

/** Plafond de lignes membres lues pour une liste (la liste des projets est elle-même bornée). */
const MEMBERSHIPS_LIMIT = 1000;

export interface SharedProgram {
  role: MemberRole;
  /** Nom du propriétaire (affiché sur la carte d'un projet partagé). */
  ownerName: string;
}

/**
 * Projets ACTIFS partagés avec `userId` (programId → rôle de membre et nom du
 * propriétaire), en une requête par l'index ProgramMember(userId). Une ligne membre
 * parasite du propriétaire est écartée (il garde son rôle de propriétaire).
 * Une liste s'écrit ensuite `deletedAt IS NULL AND (ownerId = $1 OR id = ANY($ids))`,
 * deux prédicats indexés (BitmapOr), au lieu de l'EXISTS par ligne de
 * `members: { some }` qui force un parcours séquentiel de Program.
 */
export async function accessibleProgramIds(client: Db | Tx, userId: string): Promise<Map<string, SharedProgram>> {
  const rows = await client.$queryRaw<{ programId: string; role: string; ownerName: string }[]>`
    SELECT m."programId", m."role", u."name" AS "ownerName"
    FROM "ProgramMember" m
    JOIN "Program" p ON p."id" = m."programId"
    JOIN "user" u ON u."id" = p."ownerId"
    WHERE m."userId" = ${userId} AND p."ownerId" <> ${userId} AND p."deletedAt" IS NULL
    LIMIT ${MEMBERSHIPS_LIMIT}`;
  const result = new Map<string, SharedProgram>();
  for (const row of rows) {
    const role = memberRole(row.role);
    if (role) result.set(row.programId, { role, ownerName: row.ownerName });
  }
  return result;
}

type ResourceLabel = ConstructorParameters<typeof NotFoundError>[0];

/** Ligne absente ou sans rôle → 404 ; rôle insuffisant → 403 ; sinon le rôle. */
function requireRole(
  userId: string,
  row: { ownerId: string; role: string | null } | undefined,
  min: ProgramRole,
  resource: ResourceLabel,
): ProgramRole {
  const role = row ? roleOf(userId, row.ownerId, row.role) : null;
  if (!role) throw new NotFoundError(resource);
  if (!hasRole(role, min)) throw new ForbiddenError();
  return role;
}

/**
 * Portée d'un verrou : objet actif (`live`), ou objet à la corbeille depuis moins de
 * UNDO_WINDOW_SECONDS (`undoable`, pour une restauration).
 */
export type LockScope = "live" | "undoable";

function deletedAtCondition(column: Prisma.Sql, scope: LockScope): Prisma.Sql {
  return scope === "live"
    ? Prisma.sql`${column} IS NULL`
    : Prisma.sql`${column} > now() - (${UNDO_WINDOW_SECONDS}::int * interval '1 second')`;
}

/**
 * Verrouille la ligne du projet (SELECT … FOR UPDATE OF p) si `userId` y a accès,
 * puis exige `min`. Sérialise les écritures concurrentes sur le projet (positions des
 * sujets, plafonds, corbeille). Renvoie le rôle de l'appelant.
 * La condition d'accès est dans le WHERE : on ne verrouille jamais le projet d'autrui.
 */
export async function lockProgramFor(
  tx: Tx,
  userId: string,
  programId: string,
  min: ProgramRole,
  scope: LockScope = "live",
): Promise<ProgramRole> {
  const rows = await tx.$queryRaw<{ ownerId: string; role: string | null }[]>`
    SELECT p."ownerId", m."role"
    FROM "Program" p
    LEFT JOIN "ProgramMember" m ON m."programId" = p."id" AND m."userId" = ${userId}
    WHERE p."id" = ${programId}
      AND ${deletedAtCondition(Prisma.sql`p."deletedAt"`, scope)}
      AND (p."ownerId" = ${userId} OR m."userId" IS NOT NULL)
    FOR UPDATE OF p`;
  return requireRole(userId, rows[0], min, "programme");
}

export interface LockedDeck {
  programId: string;
  themeId: string | null;
  kind: "SKELETON" | "FINAL";
  role: ProgramRole;
}

/**
 * Verrouille un deck (et seulement lui : FOR UPDATE OF d) d'un projet actif auquel
 * `userId` a accès, puis exige `min`. `scope: "undoable"` cible un deck à la corbeille
 * depuis moins de 30 s (restauration).
 */
export async function lockDeckFor(
  tx: Tx,
  userId: string,
  deckId: string,
  min: ProgramRole,
  scope: LockScope = "live",
): Promise<LockedDeck> {
  const rows = await tx.$queryRaw<
    { programId: string; themeId: string | null; kind: "SKELETON" | "FINAL"; ownerId: string; role: string | null }[]
  >`
    SELECT d."programId", d."themeId", d."kind"::text AS "kind", p."ownerId", m."role"
    FROM "Deck" d
    JOIN "Program" p ON p."id" = d."programId"
    LEFT JOIN "ProgramMember" m ON m."programId" = p."id" AND m."userId" = ${userId}
    WHERE d."id" = ${deckId}
      AND ${deletedAtCondition(Prisma.sql`d."deletedAt"`, scope)}
      AND p."deletedAt" IS NULL
      AND (p."ownerId" = ${userId} OR m."userId" IS NOT NULL)
    FOR UPDATE OF d`;
  const row = rows[0];
  if (!row) throw new NotFoundError("deck");
  const role = requireRole(userId, row, min, "deck");
  return { programId: row.programId, themeId: row.themeId, kind: row.kind, role };
}

/**
 * À appeler quand une requête filtrée par `programAccess(userId, min)` n'a rien
 * trouvé : ForbiddenError si `userId` voit ce projet actif avec un rôle inférieur à
 * `min`, NotFoundError sinon (absent, à la corbeille, étranger : indistinguables).
 */
export async function denyAccess(
  client: Db | Tx,
  userId: string,
  programId: string,
  min: ProgramRole,
  resource: ResourceLabel = "programme",
): Promise<never> {
  // Un lecteur est le rôle minimal : rien à distinguer, pas de requête.
  if (min !== "viewer") {
    const row = await client.program.findFirst({
      where: { id: programId, deletedAt: null },
      select: { ownerId: true, members: memberRoleOf(userId) },
    });
    const role = row ? roleOf(userId, row.ownerId, row.members[0]?.role) : null;
    if (role && !hasRole(role, min)) throw new ForbiddenError();
  }
  throw new NotFoundError(resource);
}
