import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import { computeProjectProgress } from "@/domain/progress";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { totalSlides } from "@/domain/slides";
import { db, type Db } from "../db/client";
import { ConflictError, DataIntegrityError, NotFoundError } from "../errors";
import { createLogger, type Logger } from "../logger";
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
  rehearsalCount: number;
}

/**
 * Projets actifs de l'utilisateur (possédés et partagés) avec leur avancement.
 * Deux requêtes, quel que soit le nombre de projets : les projets partagés
 * (accessibleProgramIds), puis la liste. Celle-ci filtre par deux prédicats
 * indexés (ownerId, clé primaire) et compte sujets, decks finaux actifs
 * (entraînement compris) et répétitions de l'utilisateur sur ces decks par
 * sous-requêtes corrélées sur les index (programId, …) et (deckId, …) : pas de
 * N+1, et pas d'agrégat de toute la table comme le `_count` de Prisma (GROUP BY
 * sans filtre).
 */
export async function listPrograms(userId: string, client: Db = db()): Promise<ProgramSummary[]> {
  const shared = await accessibleProgramIds(client, userId);
  const sharedIds = [...shared.keys()];
  const rows = await client.$queryRaw<ProgramListRow[]>`
    SELECT p."id", p."ownerId", p."name", p."description", p."brandSavedAt", p."templateSavedAt",
           p."createdAt", p."updatedAt",
           (SELECT count(*)::int FROM "Theme" t WHERE t."programId" = p."id") AS "themeCount",
           (SELECT count(*)::int FROM "Deck" d
             WHERE d."programId" = p."id" AND d."kind" = 'FINAL' AND d."deletedAt" IS NULL) AS "finalDeckCount",
           (SELECT count(*)::int FROM "Rehearsal" r JOIN "Deck" d ON d."id" = r."deckId"
             WHERE d."programId" = p."id" AND d."deletedAt" IS NULL AND r."userId" = ${userId}) AS "rehearsalCount"
    FROM "Program" p
    WHERE p."deletedAt" IS NULL
      AND (p."ownerId" = ${userId} OR p."id" = ANY(${sharedIds}::text[]))
    ORDER BY p."updatedAt" DESC, p."id" ASC
    LIMIT ${LIST_LIMIT}`;

  return rows.flatMap((r) => {
    // Propriétaire d'abord ; sinon le partage lu juste avant (absent : partage retiré entre-temps).
    const share = r.ownerId === userId ? null : shared.get(r.id);
    if (share === undefined) return [];
    const { doneCount, total, nextStep, rehearsalCount } = computeProjectProgress({
      subjectCount: r.themeCount,
      brandSavedAt: r.brandSavedAt?.toISOString() ?? null,
      templateSavedAt: r.templateSavedAt?.toISOString() ?? null,
      finalDeckCount: r.finalDeckCount,
      rehearsalCount: r.rehearsalCount,
    });
    return [
      {
        id: r.id,
        name: r.name,
        description: r.description,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        themeCount: r.themeCount,
        progress: { doneCount, total, nextStep, rehearsalCount },
        role: share?.role ?? "owner",
        ownerName: share?.ownerName ?? null,
      },
    ];
  });
}

/** Partie du projet illisible en base, remplacée par sa valeur par défaut à la lecture. */
export type DegradedPart = "brand" | "template";

/** ProgramDetail lu de façon tolérante : `degraded` liste les parties remplacées par défaut. */
export type ProgramDetailRead = ProgramDetail & { degraded: DegradedPart[] };

/**
 * Lit une colonne JSON ; si elle a dérivé (DataIntegrityError), renvoie la valeur
 * par défaut et journalise. Toute autre erreur remonte.
 */
function readOrDefault<T>(read: () => T, fallback: () => T, onInvalid: (error: DataIntegrityError) => void): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof DataIntegrityError)) throw error;
    onInvalid(error);
    return fallback();
  }
}

/**
 * Programme avec ses sujets ordonnés et l'ancien squelette (version 1.0) de chacun,
 * listé dans Decks, et, en parallèle, le nombre de répétitions de l'utilisateur sur
 * les decks actifs du projet (progression « prêt pour le jour J ») : deux requêtes.
 * Le compte, lancé avant le contrôle d'accès, n'est lu que si le projet est visible.
 *
 * Lecture tolérante : une apparence ou une trame invalide en base est remplacée
 * par la valeur par défaut (signalée dans `degraded`), un squelette invalide par
 * null ; chaque cas est journalisé. La page s'affiche toujours ; l'enregistrement
 * suivant réécrit une valeur valide.
 */
export async function getProgram(
  userId: string,
  programId: string,
  log: Logger = createLogger({ scope: "repo.programs" }),
): Promise<ProgramDetailRead> {
  const [row, rehearsalCount] = await Promise.all([
    db().program.findFirst({
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
    }),
    // Répétitions de l'utilisateur seul (chacun prépare son oral), decks actifs.
    db().rehearsal.count({ where: { userId, deck: { programId, ...liveDeck } } }),
  ]);
  const role = row ? roleOf(userId, row.ownerId, row.members[0]?.role) : null;
  if (!row || !role) throw new NotFoundError("programme");
  const degraded: DegradedPart[] = [];
  const degrade = (part: DegradedPart) => (error: DataIntegrityError) => {
    degraded.push(part);
    log.warn("program.read.degraded", { programId: row.id, part, issues: error.issues });
  };
  const brand = readOrDefault(() => readBrand(row.brand, row.id), defaultBrand, degrade("brand"));
  const template = readOrDefault(() => readTemplate(row.template, row.id), defaultTemplate, degrade("template"));
  const finalDeckCount = row._count.decks;
  const themes = row.themes.map((t) => {
    const deck = t.decks[0];
    const skeleton = deck
      ? readOrDefault(
          () => toDeckView(deck),
          () => null,
          (error) => log.warn("program.read.invalid_skeleton", { programId: row.id, deckId: deck.id, issues: error.issues }),
        )
      : null;
    return { ...toThemeView(t), skeleton, finalDeckCount: t._count.decks };
  });
  const brandSavedAt = row.brandSavedAt?.toISOString() ?? null;
  const templateSavedAt = row.templateSavedAt?.toISOString() ?? null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    brand,
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
      rehearsalCount,
      template: { slides: totalSlides(template), durationMinutes: template.durationMinutes },
    }),
    role,
    degraded,
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

export const BRAND_CHANGED_MESSAGE =
  "L'apparence a été modifiée entre-temps (autre onglet ou autre membre du projet). Rechargez la page pour voir la dernière version : vos réglages non enregistrés seront perdus.";
export const TEMPLATE_CHANGED_MESSAGE =
  "La trame a été modifiée entre-temps (autre onglet ou autre membre du projet). Rechargez la page pour voir la dernière version : vos réglages non enregistrés seront perdus.";

/** Même instant à la milliseconde (précision des colonnes timestamptz(3)) ; null = jamais enregistré. */
function sameVersion(current: Date | null, expected: string | null): boolean {
  if (current === null || expected === null) return current === expected;
  return current.getTime() === new Date(expected).getTime();
}

/**
 * Enregistre l'apparence (éditeur) et renvoie sa nouvelle version (`brandSavedAt`, ISO).
 *
 * Concurrence optimiste : `expectedSavedAt` est le `brandSavedAt` reçu au chargement
 * (null : jamais enregistrée). S'il ne correspond plus, l'apparence a été enregistrée
 * entre-temps : ConflictError au lieu d'écraser l'autre version. `undefined` : pas de
 * contrôle (import appliqué, modèle partagé, appelants antérieurs). Le jeton est
 * brandSavedAt et jamais Program.updatedAt, qui avance aussi pour un sujet ou la trame.
 * Lecture et écriture sous verrou de ligne (FOR UPDATE) : deux enregistrements
 * simultanés partis de la même version ne passent pas tous les deux.
 */
export async function updateBrand(
  userId: string,
  programId: string,
  brand: Brand,
  expectedSavedAt?: string | null,
): Promise<{ brandSavedAt: string }> {
  const json = brandJson(brand);
  return db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, programId, "editor");
    if (expectedSavedAt !== undefined) {
      const current = await tx.program.findUniqueOrThrow({ where: { id: programId }, select: { brandSavedAt: true } });
      if (!sameVersion(current.brandSavedAt, expectedSavedAt)) throw new ConflictError(BRAND_CHANGED_MESSAGE);
    }
    // Horloge du serveur d'application, comme updatedAt (@updatedAt est posé par le client Prisma) ;
    // milliseconde exacte : la colonne est un timestamptz(3).
    const savedAt = new Date();
    await tx.program.update({
      where: { id: programId },
      data: { brand: json, brandSavedAt: savedAt },
      select: { id: true },
    });
    return { brandSavedAt: savedAt.toISOString() };
  });
}

/** Enregistre la trame (éditeur) ; même contrat que updateBrand, avec `templateSavedAt` pour jeton. */
export async function updateTemplate(
  userId: string,
  programId: string,
  template: PromptTemplate,
  expectedSavedAt?: string | null,
): Promise<{ templateSavedAt: string }> {
  const json = templateJson(template);
  return db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, programId, "editor");
    if (expectedSavedAt !== undefined) {
      const current = await tx.program.findUniqueOrThrow({ where: { id: programId }, select: { templateSavedAt: true } });
      if (!sameVersion(current.templateSavedAt, expectedSavedAt)) throw new ConflictError(TEMPLATE_CHANGED_MESSAGE);
    }
    // Horloge du serveur d'application, comme updatedAt (@updatedAt est posé par le client Prisma) ;
    // milliseconde exacte : la colonne est un timestamptz(3).
    const savedAt = new Date();
    await tx.program.update({
      where: { id: programId },
      data: { template: json, templateSavedAt: savedAt },
      select: { id: true },
    });
    return { templateSavedAt: savedAt.toISOString() };
  });
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
