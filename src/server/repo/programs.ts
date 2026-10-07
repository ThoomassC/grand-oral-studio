import { computeProjectProgress } from "@/domain/progress";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { totalSlides } from "@/domain/slides";
import { db, type Db } from "../db/client";
import { NotFoundError } from "../errors";
import type { ProgramMeta } from "../validation";
import {
  accessibleProgramIds,
  denyAccess,
  liveDeck,
  lockProgramFor,
  memberRoleOf,
  programAccess,
  roleOf,
  type ProgramRole,
} from "./access";
import { brandJson, readBrand, readTemplate, specJson, templateJson, toDeckView, toThemeView } from "./mappers";
import { prismaErrorCode } from "./ownership";
import { purgeTrash, undoDeadline } from "./trash";
import type { ProgramDetail, ProgramSummary } from "./types";

/**
 * Programmes. Chaque fonction prend `userId` explicitement et filtre par rôle
 * (cf. ./access.ts) dans la requête elle-même. Aucune dépendance à Next/HTTP.
 * Rôle minimal : lecture et duplication = lecteur ; métadonnées, apparence,
 * trame = éditeur ; suppression et restauration = propriétaire.
 */

const LIST_LIMIT = 200;

interface ProgramListRow {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  brandSavedAt: Date | null;
  templateSavedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  themeCount: number;
  finalDeckCount: number;
}

/**
 * Projets actifs de l'utilisateur (possédés et partagés) avec leur avancement.
 * Deux requêtes, quel que soit le nombre de projets : les projets partagés
 * (accessibleProgramIds), puis la liste. Celle-ci filtre par deux prédicats
 * indexés (ownerId, clé primaire) et compte sujets et decks finaux actifs par
 * sous-requêtes corrélées sur les index (programId, …) : pas de N+1, et pas
 * d'agrégat de toute la table comme le `_count` de Prisma (GROUP BY sans filtre).
 */
export async function listPrograms(userId: string, client: Db = db()): Promise<ProgramSummary[]> {
  const shared = await accessibleProgramIds(client, userId);
  const sharedIds = [...shared.keys()];
  const rows = await client.$queryRaw<ProgramListRow[]>`
    SELECT p."id", p."ownerId", p."name", p."description", p."brandSavedAt", p."templateSavedAt",
           p."createdAt", p."updatedAt",
           (SELECT count(*)::int FROM "Theme" t WHERE t."programId" = p."id") AS "themeCount",
           (SELECT count(*)::int FROM "Deck" d
             WHERE d."programId" = p."id" AND d."kind" = 'FINAL' AND d."deletedAt" IS NULL) AS "finalDeckCount"
    FROM "Program" p
    WHERE p."deletedAt" IS NULL
      AND (p."ownerId" = ${userId} OR p."id" = ANY(${sharedIds}::text[]))
    ORDER BY p."updatedAt" DESC, p."id" ASC
    LIMIT ${LIST_LIMIT}`;

  return rows.flatMap((r) => {
    // Propriétaire d'abord ; sinon le partage lu juste avant (absent : partage retiré entre-temps).
    const share = r.ownerId === userId ? null : shared.get(r.id);
    if (share === undefined) return [];
    const { doneCount, total, nextStep } = computeProjectProgress({
      subjectCount: r.themeCount,
      brandSavedAt: r.brandSavedAt?.toISOString() ?? null,
      templateSavedAt: r.templateSavedAt?.toISOString() ?? null,
      finalDeckCount: r.finalDeckCount,
    });
    return [
      {
        id: r.id,
        name: r.name,
        description: r.description,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        themeCount: r.themeCount,
        progress: { doneCount, total, nextStep },
        role: share?.role ?? "owner",
        ownerName: share?.ownerName ?? null,
      },
    ];
  });
}

/** Programme avec ses sujets ordonnés et l'ancien squelette (version 1.0) de chacun, listé dans Decks (une seule requête). */
export async function getProgram(userId: string, programId: string): Promise<ProgramDetail> {
  const row = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "viewer") },
    include: {
      members: memberRoleOf(userId),
      themes: {
        orderBy: { position: "asc" },
        include: {
          decks: { where: { kind: "SKELETON", ...liveDeck }, take: 1 },
          _count: { select: { decks: { where: { kind: "FINAL", ...liveDeck } } } },
        },
      },
      // Total du programme : compte aussi les decks finaux sans sujet, que les compteurs par sujet ignorent.
      _count: { select: { decks: { where: { kind: "FINAL", ...liveDeck } } } },
    },
  });
  const role = row ? roleOf(userId, row.ownerId, row.members[0]?.role) : null;
  if (!row || !role) throw new NotFoundError("programme");
  const finalDeckCount = row._count.decks;
  const template = readTemplate(row.template, row.id);
  const themes = row.themes.map((t) => {
    const skeleton = t.decks[0];
    return { ...toThemeView(t), skeleton: skeleton ? toDeckView(skeleton) : null, finalDeckCount: t._count.decks };
  });
  const brandSavedAt = row.brandSavedAt?.toISOString() ?? null;
  const templateSavedAt = row.templateSavedAt?.toISOString() ?? null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    brand: readBrand(row.brand, row.id),
    template,
    brandSavedAt,
    templateSavedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    themes,
    finalDeckCount,
    progress: computeProjectProgress({
      subjectCount: themes.length,
      brandSavedAt,
      templateSavedAt,
      finalDeckCount,
      template: { slides: totalSlides(template), durationMinutes: template.durationMinutes },
    }),
    role,
  };
}

/**
 * Exige au moins `min` sur le projet actif `programId` : NotFoundError (absent,
 * étranger, à la corbeille) ou ForbiddenError (rôle inférieur). Lecture par clé primaire.
 */
export async function assertProgramAccess(userId: string, programId: string, min: ProgramRole): Promise<void> {
  const row = await db().program.findFirst({ where: { id: programId, ...programAccess(userId, min) }, select: { id: true } });
  if (!row) await denyAccess(db(), userId, programId, min);
}

/** Trame enregistrée d'un projet sur lequel `userId` a au moins `min` (base d'un import). */
export async function getProgramTemplate(userId: string, programId: string, min: ProgramRole): Promise<PromptTemplate> {
  const row = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, min) },
    select: { id: true, template: true },
  });
  if (!row) return denyAccess(db(), userId, programId, min);
  return readTemplate(row.template, row.id);
}

/** Apparence enregistrée d'un projet sur lequel `userId` a au moins `min` (base d'un import). */
export async function getProgramBrand(userId: string, programId: string, min: ProgramRole): Promise<Brand> {
  const row = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, min) },
    select: { id: true, brand: true },
  });
  if (!row) return denyAccess(db(), userId, programId, min);
  return readBrand(row.brand, row.id);
}

/**
 * Exécute une mise à jour filtrée par `programAccess(userId, min)` ; si la ligne
 * n'est pas atteinte (P2025), distingue 403 et 404 via denyAccess.
 */
async function updateWithAccess<T>(userId: string, programId: string, min: ProgramRole, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") return denyAccess(db(), userId, programId, min);
    throw error;
  }
}

export async function createProgram(
  userId: string,
  input: ProgramMeta & { brand: Brand; template: PromptTemplate },
): Promise<{ id: string }> {
  return db().program.create({
    data: {
      ownerId: userId,
      name: input.name,
      description: input.description,
      brand: brandJson(input.brand),
      template: templateJson(input.template),
    },
    select: { id: true },
  });
}

/** Nom et description : ils nourrissent la génération, donc droit d'éditeur. */
export async function updateProgramMeta(userId: string, programId: string, meta: ProgramMeta): Promise<void> {
  await updateWithAccess(userId, programId, "editor", () =>
    db().program.update({
      where: { id: programId, AND: [programAccess(userId, "editor")] },
      data: { name: meta.name, description: meta.description },
      select: { id: true },
    }),
  );
}

export async function updateBrand(userId: string, programId: string, brand: Brand): Promise<void> {
  await updateWithAccess(userId, programId, "editor", () =>
    db().program.update({
      where: { id: programId, AND: [programAccess(userId, "editor")] },
      // Même horloge que updatedAt (@updatedAt est posé par le client Prisma).
      data: { brand: brandJson(brand), brandSavedAt: new Date() },
      select: { id: true },
    }),
  );
}

export async function updateTemplate(userId: string, programId: string, template: PromptTemplate): Promise<void> {
  await updateWithAccess(userId, programId, "editor", () =>
    db().program.update({
      where: { id: programId, AND: [programAccess(userId, "editor")] },
      data: { template: templateJson(template), templateSavedAt: new Date() },
      select: { id: true },
    }),
  );
}

/**
 * Met le projet à la corbeille (propriétaire seul). Il disparaît aussitôt de toutes
 * les lectures, pour tous ses membres ; thèmes et decks restent en base jusqu'à la
 * purge (> 1 h), qui les efface en cascade. Restaurable jusqu'à `undoUntil` (ISO).
 * La purge opportuniste passe d'abord, hors de la transaction.
 */
export async function deleteProgram(userId: string, programId: string): Promise<{ undoUntil: string }> {
  await purgeTrash();
  return db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, programId, "owner");
    const rows = await tx.$queryRaw<{ deletedAt: Date }[]>`
      UPDATE "Program" SET "deletedAt" = now() WHERE "id" = ${programId} RETURNING "deletedAt"`;
    const deletedAt = rows[0]?.deletedAt;
    if (!deletedAt) throw new NotFoundError("programme"); // ligne verrouillée : ne doit pas arriver
    return { undoUntil: undoDeadline(deletedAt) };
  });
}

/**
 * Sort le projet de la corbeille (propriétaire seul), dans les 30 s qui suivent sa
 * suppression. Hors délai, déjà restauré, purgé ou inconnu → NotFoundError ;
 * membre non propriétaire → ForbiddenError.
 */
export async function restoreProgram(userId: string, programId: string): Promise<void> {
  await db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, programId, "owner", "undoable");
    await tx.$executeRaw`UPDATE "Program" SET "deletedAt" = NULL WHERE "id" = ${programId}`;
  });
}

const COPY_SUFFIX = " (copie)";

/**
 * Duplique un programme VERS LE COMPTE de `userId` (un lecteur peut dupliquer) :
 * métadonnées, apparence, trame, sujets (notes et problématiques comprises) et
 * squelettes actifs. Les decks finaux (propres à un jour J) ne sont pas copiés,
 * les membres non plus. Tout ou rien.
 */
export async function duplicateProgram(userId: string, programId: string): Promise<{ id: string }> {
  return db().$transaction(async (tx) => {
    const source = await tx.program.findFirst({
      where: { id: programId, ...programAccess(userId, "viewer") },
      include: {
        themes: {
          orderBy: { position: "asc" },
          include: { decks: { where: { kind: "SKELETON", ...liveDeck }, take: 1 } },
        },
      },
    });
    if (!source) throw new NotFoundError("programme");

    const name = `${source.name.slice(0, 120 - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
    const copy = await tx.program.create({
      data: {
        ownerId: userId,
        name,
        description: source.description,
        // Revalidés : on ne recopie pas aveuglément un JSON qui aurait dérivé.
        brand: brandJson(readBrand(source.brand, source.id)),
        template: templateJson(readTemplate(source.template, source.id)),
        // La copie reprend l'avancement de la source : charte et gabarit sont recopiés tels quels.
        brandSavedAt: source.brandSavedAt,
        templateSavedAt: source.templateSavedAt,
      },
      select: { id: true },
    });

    if (source.themes.length === 0) return copy;

    const newThemes = await tx.theme.createManyAndReturn({
      data: source.themes.map((t) => ({
        programId: copy.id,
        position: t.position,
        name: t.name,
        description: t.description,
        keywords: t.keywords,
        notes: t.notes,
        problems: t.problems,
      })),
      select: { id: true, position: true },
    });
    // Correspondance par position (unique par programme), pas par ordre de RETURNING.
    const idByPosition = new Map(newThemes.map((t) => [t.position, t.id]));

    const skeletons = source.themes.flatMap((t) => {
      const deck = t.decks[0];
      const themeId = idByPosition.get(t.position);
      if (!deck || !themeId) return [];
      const view = toDeckView(deck);
      return [{ programId: copy.id, themeId, kind: "SKELETON" as const, spec: specJson(view.spec), engine: view.engine }];
    });
    if (skeletons.length > 0) {
      await tx.deck.createMany({ data: skeletons });
    }
    return copy;
  });
}
