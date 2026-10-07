import type { ThemeInput } from "@/domain/schemas";
import { db, type Tx } from "../db/client";
import { ConflictError, LimitExceededError, NotFoundError } from "../errors";
import { themeNameKey } from "../theme-import";
import { MAX_THEMES_PER_PROGRAM } from "../validation";
import { lockProgramFor, programAccess } from "./access";
import { toThemeView } from "./mappers";
import type { ThemeView } from "./types";

/**
 * Sujets (identifiant de code historique : « theme »). Invariant : dans un programme, les positions forment 0..n-1 sans trou,
 * garanti par UNIQUE(programId, position) + réécriture complète sous verrou.
 *
 * Toute écriture verrouille d'abord la ligne Program (FOR UPDATE) sous condition
 * de rôle (éditeur) et d'état (hors corbeille) : deux ajouts simultanés ne
 * calculent jamais la même position. La lecture demande le rôle de lecteur.
 */

/**
 * Réécrit les positions dans l'ordre de `orderedIds`, en deux temps pour ne
 * jamais violer l'unicité (PostgreSQL vérifie un UNIQUE non différé ligne par
 * ligne) : 1) tout passe en négatif, 2) chaque ligne prend son rang final.
 */
async function rewritePositions(tx: Tx, programId: string, orderedIds: string[]): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Theme" SET "position" = -"position" - 1
    WHERE "programId" = ${programId}`;
  if (orderedIds.length === 0) return;
  const updated = await tx.$executeRaw`
    UPDATE "Theme" AS t SET "position" = v.ord - 1
    FROM unnest(${orderedIds}::text[]) WITH ORDINALITY AS v(id, ord)
    WHERE t."id" = v.id AND t."programId" = ${programId}`;
  if (updated !== orderedIds.length) {
    // Ne doit pas arriver sous verrou ; la transaction est annulée.
    throw new ConflictError("La liste des sujets a changé entre-temps. Rechargez la page.");
  }
}

async function nextPosition(tx: Tx, programId: string): Promise<{ position: number; count: number }> {
  const agg = await tx.theme.aggregate({
    where: { programId },
    _max: { position: true },
    _count: { _all: true },
  });
  return { position: (agg._max.position ?? -1) + 1, count: agg._count._all };
}

export async function listThemes(userId: string, programId: string): Promise<ThemeView[]> {
  const program = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "viewer") },
    select: { themes: { orderBy: { position: "asc" } } },
  });
  // Programme absent, étranger ou à la corbeille : même réponse, pour ne pas révéler son existence.
  if (!program) throw new NotFoundError("programme");
  return program.themes.map(toThemeView);
}

export async function addTheme(userId: string, programId: string, input: ThemeInput): Promise<ThemeView> {
  return db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, programId, "editor");
    const { position, count } = await nextPosition(tx, programId);
    if (count >= MAX_THEMES_PER_PROGRAM) {
      throw new LimitExceededError(`Un projet est limité à ${MAX_THEMES_PER_PROGRAM} sujets.`);
    }
    const row = await tx.theme.create({
      data: {
        programId,
        position,
        name: input.name,
        description: input.description,
        keywords: input.keywords,
        notes: input.notes,
        problems: input.problems ?? [],
      },
    });
    await touchProgram(tx, programId);
    return toThemeView(row);
  });
}

/** Programme d'un sujet que `userId` peut au moins lire ; NotFoundError sinon (sujet étranger, projet à la corbeille). */
async function visibleThemeProgram(tx: Tx, userId: string, themeId: string): Promise<string> {
  const theme = await tx.theme.findFirst({
    where: { id: themeId, program: programAccess(userId, "viewer") },
    select: { programId: true },
  });
  if (!theme) throw new NotFoundError("thème");
  return theme.programId;
}

/**
 * Met à jour un sujet (éditeur). `input.problems` absent : problématiques inchangées
 * (formulaires antérieurs à la 1.2) ; présent : remplacées.
 */
export async function updateTheme(userId: string, themeId: string, input: ThemeInput): Promise<ThemeView> {
  return db().$transaction(async (tx) => {
    const programId = await visibleThemeProgram(tx, userId, themeId);
    await lockProgramFor(tx, userId, programId, "editor");
    const { count } = await tx.theme.updateMany({
      where: { id: themeId, programId },
      data: {
        name: input.name,
        description: input.description,
        keywords: input.keywords,
        notes: input.notes,
        ...(input.problems !== undefined ? { problems: input.problems } : {}),
      },
    });
    if (count === 0) throw new NotFoundError("thème"); // supprimé par un appel concurrent
    const row = await tx.theme.findUniqueOrThrow({ where: { id: themeId } });
    await touchProgram(tx, programId);
    return toThemeView(row);
  });
}

/** Supprime un thème (ses decks partent en cascade) et recompacte les positions. */
export async function deleteTheme(userId: string, themeId: string): Promise<{ programId: string }> {
  return db().$transaction(async (tx) => {
    const programId = await visibleThemeProgram(tx, userId, themeId);
    await lockProgramFor(tx, userId, programId, "editor");
    const { count } = await tx.theme.deleteMany({ where: { id: themeId, programId } });
    if (count === 0) throw new NotFoundError("thème"); // supprimé par un appel concurrent
    const remaining = await tx.theme.findMany({
      where: { programId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    await rewritePositions(
      tx,
      programId,
      remaining.map((t) => t.id),
    );
    await touchProgram(tx, programId);
    return { programId };
  });
}

/**
 * Réordonne. `themeIds` doit être exactement l'ensemble des thèmes du programme
 * (ni doublon, ni manquant, ni étranger) : sinon la vue cliente est périmée.
 */
export async function reorderThemes(userId: string, programId: string, themeIds: string[]): Promise<void> {
  await db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, programId, "editor");
    const current = await tx.theme.findMany({ where: { programId }, select: { id: true } });
    const currentIds = new Set(current.map((t) => t.id));
    const requested = new Set(themeIds);
    const sameSet =
      requested.size === themeIds.length &&
      requested.size === currentIds.size &&
      themeIds.every((id) => currentIds.has(id));
    if (!sameSet) {
      throw new ConflictError("La liste des sujets a changé entre-temps. Rechargez la page.");
    }
    await rewritePositions(tx, programId, themeIds);
    await touchProgram(tx, programId);
  });
}

/**
 * Ajoute des thèmes en fin de liste. Idempotent par nom : un thème dont le nom
 * (insensible à la casse et aux accents) existe déjà est ignoré, si bien qu'un
 * import rejoué ne crée pas de doublons.
 */
export async function importThemes(
  userId: string,
  programId: string,
  inputs: ThemeInput[],
): Promise<{ created: number; skipped: string[] }> {
  return db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, programId, "editor");
    const existing = await tx.theme.findMany({ where: { programId }, select: { name: true } });
    const known = new Set(existing.map((t) => themeNameKey(t.name)));
    const skipped: string[] = [];
    const fresh: ThemeInput[] = [];
    for (const input of inputs) {
      const key = themeNameKey(input.name);
      if (known.has(key)) {
        skipped.push(input.name);
        continue;
      }
      known.add(key);
      fresh.push(input);
    }
    if (existing.length + fresh.length > MAX_THEMES_PER_PROGRAM) {
      throw new LimitExceededError(
        `Un projet est limité à ${MAX_THEMES_PER_PROGRAM} sujets (${existing.length} existants, ${fresh.length} à importer).`,
      );
    }
    if (fresh.length > 0) {
      const { position } = await nextPosition(tx, programId);
      await tx.theme.createMany({
        data: fresh.map((t, i) => ({
          programId,
          position: position + i,
          name: t.name,
          description: t.description,
          keywords: t.keywords,
          notes: t.notes,
          problems: t.problems ?? [],
        })),
      });
      await touchProgram(tx, programId);
    }
    return { created: fresh.length, skipped };
  });
}

/** Met à jour Program.updatedAt (tri de la liste des programmes). */
async function touchProgram(tx: Tx, programId: string): Promise<void> {
  await tx.program.update({ where: { id: programId }, data: { updatedAt: new Date() }, select: { id: true } });
}
