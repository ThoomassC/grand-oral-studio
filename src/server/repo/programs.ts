import type { Brand, PromptTemplate } from "@/domain/schemas";
import { db } from "../db/client";
import { NotFoundError } from "../errors";
import type { ProgramMeta } from "../validation";
import { brandJson, readBrand, readTemplate, specJson, templateJson, toDeckView, toThemeView } from "./mappers";
import { orNotFound, ownedProgram } from "./ownership";
import type { ProgramDetail, ProgramSummary } from "./types";

/**
 * Programmes. Chaque fonction prend `userId` explicitement et filtre par
 * propriétaire dans la requête elle-même. Aucune dépendance à Next/HTTP.
 */

const LIST_LIMIT = 200;

export async function listPrograms(userId: string): Promise<ProgramSummary[]> {
  const rows = await db().program.findMany({
    where: ownedProgram(userId),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: LIST_LIMIT,
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { themes: true, decks: { where: { kind: "SKELETON" } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    themeCount: r._count.themes,
    // Un squelette au plus par thème (index unique partiel) : compter les decks SKELETON = compter les thèmes couverts.
    skeletonCount: r._count.decks,
  }));
}

/** Programme avec ses thèmes ordonnés et le squelette de chaque thème (une seule requête). */
export async function getProgram(userId: string, programId: string): Promise<ProgramDetail> {
  const row = await db().program.findFirst({
    where: { id: programId, ...ownedProgram(userId) },
    include: {
      themes: {
        orderBy: { position: "asc" },
        include: {
          decks: { where: { kind: "SKELETON" }, take: 1 },
          _count: { select: { decks: { where: { kind: "FINAL" } } } },
        },
      },
    },
  });
  if (!row) throw new NotFoundError("programme");
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    brand: readBrand(row.brand, row.id),
    template: readTemplate(row.template, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    themes: row.themes.map((t) => {
      const skeleton = t.decks[0];
      return { ...toThemeView(t), skeleton: skeleton ? toDeckView(skeleton) : null, finalDeckCount: t._count.decks };
    }),
  };
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

export async function updateProgramMeta(userId: string, programId: string, meta: ProgramMeta): Promise<void> {
  await orNotFound(
    db().program.update({
      where: { id: programId, ...ownedProgram(userId) },
      data: { name: meta.name, description: meta.description },
      select: { id: true },
    }),
    "programme",
  );
}

export async function updateBrand(userId: string, programId: string, brand: Brand): Promise<void> {
  await orNotFound(
    db().program.update({
      where: { id: programId, ...ownedProgram(userId) },
      data: { brand: brandJson(brand) },
      select: { id: true },
    }),
    "programme",
  );
}

export async function updateTemplate(userId: string, programId: string, template: PromptTemplate): Promise<void> {
  await orNotFound(
    db().program.update({
      where: { id: programId, ...ownedProgram(userId) },
      data: { template: templateJson(template) },
      select: { id: true },
    }),
    "programme",
  );
}

/** Suppression ; thèmes et decks partent en cascade (ON DELETE CASCADE). */
export async function deleteProgram(userId: string, programId: string): Promise<void> {
  const { count } = await db().program.deleteMany({ where: { id: programId, ...ownedProgram(userId) } });
  if (count === 0) throw new NotFoundError("programme");
}

const COPY_SUFFIX = " (copie)";

/**
 * Duplique un programme : métadonnées, charte, gabarit, thèmes et squelettes.
 * Les decks finaux (propres à un jour J) ne sont pas copiés. Tout ou rien.
 */
export async function duplicateProgram(userId: string, programId: string): Promise<{ id: string }> {
  return db().$transaction(async (tx) => {
    const source = await tx.program.findFirst({
      where: { id: programId, ...ownedProgram(userId) },
      include: {
        themes: {
          orderBy: { position: "asc" },
          include: { decks: { where: { kind: "SKELETON" }, take: 1 } },
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
      })),
      select: { id: true, position: true },
    });
    // Correspondance par position (unique par programme), pas par ordre de RETURNING.
    const idByPosition = new Map(newThemes.map((t) => [t.position, t.id]));

    const skeletons = source.themes.flatMap((t) => {
      const deck = t.decks[0];
      const themeId = idByPosition.get(t.position);
      if (!deck || !themeId) return [];
      return [{ programId: copy.id, themeId, kind: "SKELETON" as const, spec: specJson(toDeckView(deck).spec) }];
    });
    if (skeletons.length > 0) {
      await tx.deck.createMany({ data: skeletons });
    }
    return copy;
  });
}
