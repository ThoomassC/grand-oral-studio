import type { ProgramContext, ThemeRef } from "@/domain/contracts";
import { replaceSlide } from "@/domain/deck";
import { DeckSpecSchema, type Brand, type DeckSpec, type Slide } from "@/domain/schemas";
import { db } from "../db/client";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { parseStored } from "../validation";
import { readBrand, readTemplate, specJson, toDeckView } from "./mappers";
import { lockOwnedDeck, ownedProgram, prismaErrorCode } from "./ownership";
import type { DeckEngine, DeckView, DeckWithProgram, FinalDeckSummary } from "./types";

/**
 * Decks. Un deck appartient au programme qui appartient à l'utilisateur ; la
 * clé étrangère composite (themeId, programId) → Theme(id, programId) garantit
 * en base qu'un deck ne pointe jamais vers le thème d'un autre programme.
 */

const FINAL_DECKS_LIMIT = 100;

// ---------------------------------------------------------------------------
// Contextes de génération (lectures, hors transaction : l'appel IA suit)
// ---------------------------------------------------------------------------

export interface GenerationContext {
  programId: string;
  ctx: ProgramContext;
  brand: Brand;
  themes: ThemeRef[];
}

function toThemeRef(t: { id: string; name: string; description: string; keywords: string[] }): ThemeRef {
  return { id: t.id, name: t.name, description: t.description, keywords: t.keywords };
}

export async function getGenerationContext(userId: string, programId: string): Promise<GenerationContext> {
  const row = await db().program.findFirst({
    where: { id: programId, ...ownedProgram(userId) },
    include: { themes: { orderBy: { position: "asc" } } },
  });
  if (!row) throw new NotFoundError("programme");
  const themes = row.themes.map(toThemeRef);
  return {
    programId: row.id,
    brand: readBrand(row.brand, row.id),
    themes,
    ctx: { name: row.name, description: row.description, themes, template: readTemplate(row.template, row.id) },
  };
}

/** Contexte complet d'un thème possédé : programme, thème ciblé et squelette existant. */
export async function getThemeGenerationContext(
  userId: string,
  themeId: string,
): Promise<GenerationContext & { theme: ThemeRef; skeleton: DeckSpec | null }> {
  const theme = await db().theme.findFirst({
    where: { id: themeId, program: ownedProgram(userId) },
    select: { programId: true },
  });
  if (!theme) throw new NotFoundError("thème");
  const base = await getGenerationContext(userId, theme.programId);
  const target = base.themes.find((t) => t.id === themeId);
  if (!target) throw new NotFoundError("thème"); // supprimé entre les deux lectures
  const skeleton = await db().deck.findFirst({
    where: { themeId, programId: theme.programId, kind: "SKELETON" },
    select: { id: true, spec: true },
  });
  return {
    ...base,
    theme: target,
    skeleton: skeleton ? parseStored(DeckSpecSchema, skeleton.spec, "Deck.spec", skeleton.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

/**
 * Crée ou remplace LE squelette du thème. L'unicité est garantie par l'index
 * unique partiel `Deck_one_skeleton_per_theme` (themeId WHERE kind='SKELETON') ;
 * le code tente une mise à jour, sinon une insertion, et si une insertion
 * concurrente a gagné (P2002) il retombe sur la mise à jour. Jamais deux
 * squelettes, jamais d'erreur visible pour une double génération.
 */
export async function upsertSkeleton(
  userId: string,
  themeId: string,
  spec: DeckSpec,
  /** Toujours fourni par le service ; null = inconnu. */
  engine: DeckEngine | null = null,
): Promise<{ deckId: string }> {
  const json = specJson(spec);
  const owned = { themeId, kind: "SKELETON" as const, program: ownedProgram(userId) };

  const update = async (): Promise<{ deckId: string } | null> => {
    const existing = await db().deck.findFirst({ where: owned, select: { id: true } });
    if (!existing) return null;
    const { count } = await db().deck.updateMany({ where: { id: existing.id, ...owned }, data: { spec: json, engine } });
    return count === 1 ? { deckId: existing.id } : null;
  };

  const updated = await update();
  if (updated) return updated;

  const theme = await db().theme.findFirst({
    where: { id: themeId, program: ownedProgram(userId) },
    select: { programId: true },
  });
  if (!theme) throw new NotFoundError("thème");

  try {
    const created = await db().deck.create({
      data: { programId: theme.programId, themeId, kind: "SKELETON", spec: json, engine },
      select: { id: true },
    });
    return { deckId: created.id };
  } catch (error) {
    const code = prismaErrorCode(error);
    if (code === "P2002") {
      const retried = await update();
      if (retried) return retried;
    }
    // P2003 : le thème a été supprimé pendant la génération.
    if (code === "P2003") throw new NotFoundError("thème");
    throw error;
  }
}

export async function createFinalDeck(
  userId: string,
  input: { programId: string; themeId: string; problem: string; spec: DeckSpec; engine?: DeckEngine | null },
): Promise<{ deckId: string }> {
  const json = specJson(input.spec);
  return db().$transaction(async (tx) => {
    const program = await tx.program.findFirst({
      where: { id: input.programId, ...ownedProgram(userId) },
      select: { id: true },
    });
    if (!program) throw new NotFoundError("programme");
    try {
      const created = await tx.deck.create({
        data: {
          programId: program.id,
          themeId: input.themeId,
          kind: "FINAL",
          problem: input.problem,
          spec: json,
          engine: input.engine ?? null,
        },
        select: { id: true },
      });
      return { deckId: created.id };
    } catch (error) {
      // FK composite : thème absent ou d'un autre programme.
      if (prismaErrorCode(error) === "P2003") throw new NotFoundError("thème");
      throw error;
    }
  });
}

/**
 * Deck FINAL identique (même thème, même problématique) créé récemment : sert
 * à absorber un double envoi / un retry client sans regénérer.
 */
export async function findRecentFinalDeck(
  userId: string,
  input: { programId: string; themeId: string; problem: string; sinceMs: number; engine?: DeckEngine },
): Promise<{ deckId: string } | null> {
  const row = await db().deck.findFirst({
    where: {
      programId: input.programId,
      themeId: input.themeId,
      kind: "FINAL",
      problem: input.problem,
      // Changer de moteur puis relancer doit produire un nouveau deck, pas renvoyer l'ancien.
      ...(input.engine !== undefined ? { engine: input.engine } : {}),
      createdAt: { gte: new Date(Date.now() - input.sinceMs) },
      program: ownedProgram(userId),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row ? { deckId: row.id } : null;
}

export const DECK_CHANGED_MESSAGE =
  "Ce diaporama a changé entre-temps (régénération ou autre onglet). Rechargez la page pour voir la dernière version.";

/**
 * Remplace une diapo. read → modify → write sous verrou de ligne (FOR UPDATE).
 *
 * Concurrence optimiste : si `expectedUpdatedAt` (ISO) est fourni et que le deck
 * a été modifié depuis (autre onglet, régénération du squelette), l'écriture
 * est refusée (ConflictError) au lieu d'écraser silencieusement l'autre version.
 */
export async function updateDeckSlide(
  userId: string,
  deckId: string,
  index: number,
  slide: Slide,
  expectedUpdatedAt?: string,
): Promise<{ programId: string; spec: DeckSpec; updatedAt: string }> {
  return db().$transaction(async (tx) => {
    const { programId } = await lockOwnedDeck(tx, userId, deckId);
    const row = await tx.deck.findUniqueOrThrow({ where: { id: deckId }, select: { spec: true, updatedAt: true } });
    if (expectedUpdatedAt !== undefined && row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new ConflictError(DECK_CHANGED_MESSAGE);
    }
    const current = parseStored(DeckSpecSchema, row.spec, "Deck.spec", deckId);
    if (index < 0 || index >= current.slides.length) {
      throw new ValidationError("Cette diapo n'existe pas.", {
        index: [`L'index doit être compris entre 0 et ${current.slides.length - 1}.`],
      });
    }
    const next = replaceSlide(current, index, slide);
    const updated = await tx.deck.update({
      where: { id: deckId },
      data: { spec: specJson(next) },
      select: { updatedAt: true },
    });
    return { programId, spec: next, updatedAt: updated.updatedAt.toISOString() };
  });
}

/** Thèmes du programme (possédé) qui ont déjà un squelette. */
export async function listSkeletonThemeIds(userId: string, programId: string): Promise<Set<string>> {
  const rows = await db().deck.findMany({
    where: { programId, kind: "SKELETON", program: ownedProgram(userId) },
    select: { themeId: true },
  });
  return new Set(rows.map((r) => r.themeId));
}

export async function deleteDeck(userId: string, deckId: string): Promise<{ programId: string; themeId: string }> {
  return db().$transaction(async (tx) => {
    const deck = await tx.deck.findFirst({
      where: { id: deckId, program: ownedProgram(userId) },
      select: { programId: true, themeId: true },
    });
    if (!deck) throw new NotFoundError("deck");
    const { count } = await tx.deck.deleteMany({ where: { id: deckId, program: ownedProgram(userId) } });
    if (count === 0) throw new NotFoundError("deck");
    return deck;
  });
}

// ---------------------------------------------------------------------------
// Lectures pour les pages
// ---------------------------------------------------------------------------

export async function getDeck(userId: string, deckId: string): Promise<DeckWithProgram> {
  const row = await db().deck.findFirst({
    where: { id: deckId, program: ownedProgram(userId) },
    include: {
      theme: { select: { name: true } },
      program: { select: { id: true, name: true, brand: true, template: true } },
    },
  });
  if (!row) throw new NotFoundError("deck");
  const view: DeckView = toDeckView(row);
  return {
    ...view,
    updatedAt: view.updatedAt.toISOString(),
    themeName: row.theme.name,
    program: {
      id: row.program.id,
      name: row.program.name,
      brand: readBrand(row.program.brand, row.program.id),
      template: readTemplate(row.program.template, row.program.id),
    },
  };
}

export async function listFinalDecks(userId: string, programId: string): Promise<FinalDeckSummary[]> {
  const program = await db().program.findFirst({
    where: { id: programId, ...ownedProgram(userId) },
    select: { id: true },
  });
  if (!program) throw new NotFoundError("programme");
  const rows = await db().deck.findMany({
    where: { programId, kind: "FINAL" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: FINAL_DECKS_LIMIT,
    include: { theme: { select: { name: true } } },
  });
  return rows.map((r) => {
    const view = toDeckView(r);
    return {
      id: r.id,
      engine: view.engine,
      themeId: r.themeId,
      themeName: r.theme.name,
      problem: r.problem ?? "",
      title: view.spec.title,
      createdAt: r.createdAt,
    };
  });
}
