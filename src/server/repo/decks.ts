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
 * en base qu'un deck ne pointe jamais vers le sujet d'un autre programme.
 * `themeId` NULL = deck final produit sans sujet (MATCH SIMPLE : non contrôlé) ;
 * un squelette a toujours un sujet (CHECK "Deck_skeleton_has_theme").
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

function toThemeRef(t: { id: string; name: string; description: string; keywords: string[]; notes: string }): ThemeRef {
  return { id: t.id, name: t.name, description: t.description, keywords: t.keywords, notes: t.notes };
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

export interface FinalDeckContext {
  programId: string;
  /** ctx.themes : tous les sujets du programme (avec leurs notes). */
  ctx: ProgramContext;
  brand: Brand;
  /** Sujet choisi, ou null (sans sujet). */
  subject: ThemeRef | null;
}

/**
 * Contexte du deck final (jour J). Lecture filtrée par propriétaire :
 * programme absent ou étranger → NotFoundError("programme") ; `themeId` inconnu
 * DANS CE programme (absent, ou sujet d'un autre programme) → NotFoundError("thème").
 */
export async function getFinalDeckContext(
  userId: string,
  programId: string,
  themeId: string | null,
): Promise<FinalDeckContext> {
  const { ctx, brand } = await getGenerationContext(userId, programId);
  let subject: ThemeRef | null = null;
  if (themeId !== null) {
    subject = ctx.themes.find((t) => t.id === themeId) ?? null;
    if (!subject) throw new NotFoundError("thème");
  }
  return { programId, ctx, brand, subject };
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

/**
 * Crée un deck final. Autorisation revérifiée dans la transaction (programme
 * possédé) ; un sujet hors du programme est refusé par la FK composite.
 * `themeId: null` = deck sans sujet.
 */
export async function createFinalDeck(
  userId: string,
  input: { programId: string; themeId: string | null; problem: string; spec: DeckSpec; engine?: DeckEngine | null },
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
      // FK composite : sujet absent ou d'un autre programme.
      if (prismaErrorCode(error) === "P2003") throw new NotFoundError("thème");
      throw error;
    }
  });
}

/**
 * Deck FINAL identique (même sujet — ou même absence de sujet —, même
 * problématique) créé récemment : sert à absorber un double envoi / un retry
 * client sans regénérer. `themeId: null` filtre les decks sans sujet (IS NULL).
 */
export async function findRecentFinalDeck(
  userId: string,
  input: { programId: string; themeId: string | null; problem: string; sinceMs: number; engine?: DeckEngine },
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
  "Ce diaporama a changé entre-temps (autre onglet). Rechargez la page pour voir la dernière version.";

/**
 * Remplace une diapo. read → modify → write sous verrou de ligne (FOR UPDATE).
 *
 * Concurrence optimiste : si `expectedUpdatedAt` (ISO) est fourni et que le deck
 * a été modifié depuis (autre onglet), l'écriture
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

export async function deleteDeck(userId: string, deckId: string): Promise<{ programId: string; themeId: string | null }> {
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
    themeName: row.theme?.name ?? null,
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
      themeName: r.theme?.name ?? null,
      problem: r.problem ?? "",
      title: view.spec.title,
      createdAt: r.createdAt,
    };
  });
}
