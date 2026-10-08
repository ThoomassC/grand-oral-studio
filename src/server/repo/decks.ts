import type { ProgramContext, ThemeRef } from "@/domain/contracts";
import {
  COVER_SECTION_ID,
  DeckEditError,
  duplicateDeckSpec,
  insertSlide as insertSlideIn,
  moveSlide as moveSlideIn,
  removeSlide as removeSlideIn,
  replaceSlide,
} from "@/domain/deck";
import { DeckSpecSchema, type Brand, type DeckSpec, type PromptTemplate, type Slide } from "@/domain/schemas";
import { z } from "zod";
import { db } from "../db/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { createLogger, type Logger } from "../logger";
import { parseStored } from "../validation";
import { denyAccess, hasRole, liveDeck, lockDeckFor, lockProgramFor, memberRoleOf, programAccess, roleOf } from "./access";
import { DeckEngineSchema, readBrand, readTemplate, specJson, toDeckView } from "./mappers";
import { prismaErrorCode } from "./ownership";
import { purgeTrash, undoDeadline } from "./trash";
import type { DeckEngine, DeckView, DeckWithProgram, FinalDeckSummary } from "./types";

/**
 * Decks. Un deck appartient à un programme ; l'accès se juge sur le rôle de
 * l'utilisateur dans ce programme (cf. ./access.ts) : lecture = lecteur ;
 * génération, édition, suppression, restauration = éditeur. Un deck à la
 * corbeille (`deletedAt`) ou d'un projet à la corbeille est invisible. La
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

/** Contexte de génération : droit d'éditeur (la génération écrit un deck dans le projet). */
export async function getGenerationContext(userId: string, programId: string): Promise<GenerationContext> {
  const row = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "editor") },
    include: { themes: { orderBy: { position: "asc" } } },
  });
  if (!row) return denyAccess(db(), userId, programId, "editor");
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
 * Contexte du deck final (jour J). Lecture filtrée par rôle (éditeur) :
 * programme absent ou étranger → NotFoundError("programme"), lecteur → ForbiddenError ; `themeId` inconnu
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

export interface CreateFinalDeckInput {
  programId: string;
  themeId: string | null;
  problem: string;
  spec: DeckSpec;
  engine?: DeckEngine | null;
  /** Deck d'entraînement ; défaut false (jour J). */
  practice?: boolean;
  /** Départ du chrono de préparation ; défaut null. */
  prepStartedAt?: Date | null;
  /** Rédacteur du deck ; défaut null (inconnu). */
  createdById?: string | null;
}

/**
 * Crée un deck final. Autorisation revérifiée dans la transaction : la ligne du
 * programme est verrouillée sous condition de rôle (éditeur) et d'état (hors
 * corbeille), si bien qu'une mise à la corbeille concurrente ne laisse pas naître
 * un deck orphelin. Un sujet hors du programme est refusé par la FK composite.
 * `themeId: null` = deck sans sujet.
 */
export async function createFinalDeck(userId: string, input: CreateFinalDeckInput): Promise<{ deckId: string }> {
  const json = specJson(input.spec);
  return db().$transaction(async (tx) => {
    await lockProgramFor(tx, userId, input.programId, "editor");
    try {
      const created = await tx.deck.create({
        data: {
          programId: input.programId,
          themeId: input.themeId,
          kind: "FINAL",
          problem: input.problem,
          spec: json,
          engine: input.engine ?? null,
          practice: input.practice ?? false,
          prepStartedAt: input.prepStartedAt ?? null,
          createdById: input.createdById ?? null,
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
  input: {
    programId: string;
    themeId: string | null;
    problem: string;
    sinceMs: number;
    engine?: DeckEngine;
    /** Entraînement ou jour J : jamais l'un pour l'autre. Défaut false. */
    practice?: boolean;
  },
): Promise<{ deckId: string } | null> {
  const row = await db().deck.findFirst({
    where: {
      programId: input.programId,
      themeId: input.themeId,
      kind: "FINAL",
      problem: input.problem,
      practice: input.practice ?? false,
      ...liveDeck,
      // Changer de moteur puis relancer doit produire un nouveau deck, pas renvoyer l'ancien.
      ...(input.engine !== undefined ? { engine: input.engine } : {}),
      createdAt: { gte: new Date(Date.now() - input.sinceMs) },
      // Même droit que la génération qu'il remplace : éditeur.
      program: programAccess(userId, "editor"),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, program: { select: { updatedAt: true } } },
  });
  // Projet modifié depuis (notes d'un sujet, trame, apparence : Program.updatedAt avance) :
  // le deck récent ne reflète plus le contexte, on régénère.
  if (!row || row.createdAt < row.program.updatedAt) return null;
  return { deckId: row.id };
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
    const { programId } = await lockDeckFor(tx, userId, deckId, "editor");
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

// ---------------------------------------------------------------------------
// Édition structurelle (v1.2) : insérer, supprimer, déplacer, dupliquer
// ---------------------------------------------------------------------------

export interface DeckEditResult {
  programId: string;
  spec: DeckSpec;
  /** Nouvelle version (ISO), à renvoyer avec la modification suivante. */
  updatedAt: string;
}

/** Refus du domaine (bornes, couverture) → message montrable, sans détail technique. */
function toValidationError(error: DeckEditError): ValidationError {
  return new ValidationError(
    error.code === "INDEX_OUT_OF_RANGE" ? "Cette diapo n'existe plus : rechargez le diaporama." : error.message,
  );
}

/**
 * read → modify → write d'une spec sous verrou de ligne (éditeur), avec le même
 * contrôle de version que `updateDeckSlide`. `edit` est une fonction pure du
 * domaine ; ses refus (DeckEditError) deviennent des ValidationError.
 */
async function editDeckSpec(
  userId: string,
  deckId: string,
  expectedUpdatedAt: string | undefined,
  edit: (current: DeckSpec) => DeckSpec,
): Promise<DeckEditResult> {
  return db().$transaction(async (tx) => {
    const { programId } = await lockDeckFor(tx, userId, deckId, "editor");
    const row = await tx.deck.findUniqueOrThrow({ where: { id: deckId }, select: { spec: true, updatedAt: true } });
    if (expectedUpdatedAt !== undefined && row.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new ConflictError(DECK_CHANGED_MESSAGE);
    }
    const current = parseStored(DeckSpecSchema, row.spec, "Deck.spec", deckId);
    let next: DeckSpec;
    try {
      next = edit(current);
    } catch (error) {
      if (error instanceof DeckEditError) throw toValidationError(error);
      throw error;
    }
    const updated = await tx.deck.update({
      where: { id: deckId },
      data: { spec: specJson(next) },
      select: { updatedAt: true },
    });
    return { programId, spec: next, updatedAt: updated.updatedAt.toISOString() };
  });
}

export interface SlideEditContext {
  programId: string;
  spec: DeckSpec;
  /** Version (ISO) lue : comparée à celle du client avant tout appel IA. */
  updatedAt: string;
  /** Problématique ("" pour un ancien squelette). */
  problem: string;
  template: PromptTemplate;
  subject: ThemeRef | null;
}

/**
 * Ce qu'il faut pour réécrire une diapo par IA : le deck, sa version, la trame,
 * le sujet. Droit d'ÉDITEUR, vérifié en une lecture (inconnu → 404, lecteur →
 * 403). Lecture hors transaction : l'appel IA suit, puis l'écriture
 * (`updateDeckSlide`) revérifie droit et version sous verrou.
 */
export async function getSlideEditContext(userId: string, deckId: string): Promise<SlideEditContext> {
  const row = await db().deck.findFirst({
    where: { id: deckId, ...liveDeck, program: programAccess(userId, "viewer") },
    select: {
      programId: true,
      spec: true,
      problem: true,
      updatedAt: true,
      theme: { select: { id: true, name: true, description: true, keywords: true, notes: true } },
      program: { select: { template: true, ownerId: true, members: memberRoleOf(userId) } },
    },
  });
  const role = row ? roleOf(userId, row.program.ownerId, row.program.members[0]?.role) : null;
  if (!row || !role) throw new NotFoundError("deck");
  if (!hasRole(role, "editor")) throw new ForbiddenError();
  return {
    programId: row.programId,
    spec: parseStored(DeckSpecSchema, row.spec, "Deck.spec", deckId),
    updatedAt: row.updatedAt.toISOString(),
    problem: row.problem ?? "",
    template: readTemplate(row.program.template, row.programId),
    subject: row.theme ? toThemeRef(row.theme) : null,
  };
}

/** Titre d'une diapo insérée vierge (à modifier aussitôt). */
export const NEW_SLIDE_TITLE = "Nouvelle diapo";

/**
 * Diapo vierge à insérer en position `index` : une diapo de contenu de la même
 * section que la diapo qui la précède — ou, juste après la couverture, que celle
 * qui la suit —, pour rester dans la trame.
 */
function blankSlide(deck: DeckSpec, index: number): Slide {
  const previous = deck.slides[index - 1];
  const sectionId =
    previous && previous.sectionId !== COVER_SECTION_ID
      ? previous.sectionId
      : (deck.slides[index]?.sectionId ?? previous?.sectionId ?? COVER_SECTION_ID);
  return { layout: "content", sectionId, title: NEW_SLIDE_TITLE, subtitle: "", bullets: [], notes: "" };
}

/**
 * Insère une diapo en position `index` (0..longueur). `slide` null : diapo
 * vierge de la section voisine. Au plus 60 diapos ; rien avant la couverture.
 */
export async function insertSlide(
  userId: string,
  deckId: string,
  index: number,
  slide: Slide | null,
  expectedUpdatedAt?: string,
): Promise<DeckEditResult> {
  return editDeckSpec(userId, deckId, expectedUpdatedAt, (current) =>
    insertSlideIn(current, index, slide ?? blankSlide(current, index)),
  );
}

/** Retire la diapo `index`. Au moins 2 diapos ; la couverture reste. */
export async function removeSlide(
  userId: string,
  deckId: string,
  index: number,
  expectedUpdatedAt?: string,
): Promise<DeckEditResult> {
  return editDeckSpec(userId, deckId, expectedUpdatedAt, (current) => removeSlideIn(current, index));
}

/** Déplace la diapo `from` en position `to`. La couverture reste en tête. */
export async function moveSlide(
  userId: string,
  deckId: string,
  from: number,
  to: number,
  expectedUpdatedAt?: string,
): Promise<DeckEditResult> {
  return editDeckSpec(userId, deckId, expectedUpdatedAt, (current) => moveSlideIn(current, from, to));
}

/**
 * Copie d'un deck FINAL dans le même projet (éditeur) : même sujet,
 * problématique, moteur et nature (entraînement ou jour J) ; ni questions, ni
 * répétitions, ni chrono. Le deck source est verrouillé (il ne part pas à la
 * corbeille pendant la copie) ; un ancien squelette ne se duplique pas.
 */
export async function duplicateDeck(userId: string, deckId: string): Promise<{ programId: string; deckId: string }> {
  return db().$transaction(async (tx) => {
    const { programId, kind } = await lockDeckFor(tx, userId, deckId, "editor");
    if (kind !== "FINAL") throw new ValidationError("Un ancien squelette ne se duplique pas.");
    const row = await tx.deck.findUniqueOrThrow({
      where: { id: deckId },
      select: { themeId: true, problem: true, spec: true, engine: true, practice: true },
    });
    const spec = duplicateDeckSpec(parseStored(DeckSpecSchema, row.spec, "Deck.spec", deckId));
    const created = await tx.deck.create({
      data: {
        programId,
        themeId: row.themeId,
        kind: "FINAL",
        problem: row.problem,
        spec: specJson(spec),
        engine: row.engine,
        practice: row.practice,
        createdById: userId,
      },
      select: { id: true },
    });
    return { programId, deckId: created.id };
  });
}

/**
 * Supprime un deck (éditeur). Un deck FINAL part à la corbeille, restaurable
 * jusqu'à `undoUntil` (ISO) ; un ancien squelette est supprimé définitivement
 * (pas de `undoUntil`) : l'index unique partiel Deck_one_skeleton_per_theme ne
 * connaît pas `deletedAt`, un squelette à la corbeille bloquerait le sujet.
 * Rejouée sur un deck déjà supprimé → NotFoundError. La purge opportuniste passe
 * d'abord, hors de la transaction.
 */
export async function deleteDeck(
  userId: string,
  deckId: string,
): Promise<{ programId: string; themeId: string | null; undoUntil?: string }> {
  await purgeTrash();
  return db().$transaction(async (tx) => {
    const { programId, themeId, kind } = await lockDeckFor(tx, userId, deckId, "editor");
    if (kind === "SKELETON") {
      await tx.deck.delete({ where: { id: deckId }, select: { id: true } });
      return { programId, themeId };
    }
    const rows = await tx.$queryRaw<{ deletedAt: Date }[]>`
      UPDATE "Deck" SET "deletedAt" = now() WHERE "id" = ${deckId} RETURNING "deletedAt"`;
    const deletedAt = rows[0]?.deletedAt;
    if (!deletedAt) throw new NotFoundError("deck"); // ligne verrouillée : ne doit pas arriver
    return { programId, themeId, undoUntil: undoDeadline(deletedAt) };
  });
}

/**
 * Sort un deck de la corbeille (éditeur), dans les 30 s qui suivent sa
 * suppression et tant que son projet est actif. Hors délai, purgé, déjà restauré
 * ou inconnu → NotFoundError ; lecteur → ForbiddenError.
 */
export async function restoreDeck(userId: string, deckId: string): Promise<{ programId: string; themeId: string | null }> {
  return db().$transaction(async (tx) => {
    const { programId, themeId } = await lockDeckFor(tx, userId, deckId, "editor", "undoable");
    await tx.$executeRaw`UPDATE "Deck" SET "deletedAt" = NULL WHERE "id" = ${deckId}`;
    return { programId, themeId };
  });
}

// ---------------------------------------------------------------------------
// Lectures pour les pages
// ---------------------------------------------------------------------------

/** Deck et ce qu'il faut pour l'afficher ou l'exporter : droit de lecteur. */
export async function getDeck(userId: string, deckId: string): Promise<DeckWithProgram> {
  const row = await db().deck.findFirst({
    where: { id: deckId, ...liveDeck, program: programAccess(userId, "viewer") },
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

interface FinalDeckRow {
  id: string;
  engine: string | null;
  themeId: string | null;
  themeName: string | null;
  problem: string | null;
  title: string | null;
  practice: boolean;
  createdAt: Date;
}

/** Ligne de la liste : le titre suit la règle de DeckSpec (non vide après nettoyage, 160 car. au plus). */
const FinalDeckRowSchema = z.object({
  id: z.string(),
  engine: z.string().nullable(),
  themeId: z.string().nullable(),
  themeName: z.string().nullable(),
  problem: z.string().nullable(),
  title: DeckSpecSchema.shape.title,
  practice: z.boolean(),
  createdAt: z.date(),
});

/**
 * Decks finaux actifs du projet (entraînement compris) : droit de lecteur.
 *
 * Lecture légère : seul le titre est extrait de la spec, en SQL (`spec->'title'`,
 * et seulement si c'est une chaîne JSON), au lieu de charger et valider la spec
 * complète de 100 decks. Une ligne dont le titre est invalide est ignorée et
 * journalisée : la liste s'affiche quand même. Un deck à la spec abîmée mais au
 * titre lisible reste listé ; c'est son ouverture (getDeck) qui échoue.
 */
export async function listFinalDecks(
  userId: string,
  programId: string,
  log: Logger = createLogger({ scope: "repo.decks" }),
): Promise<FinalDeckSummary[]> {
  const program = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "viewer") },
    select: { id: true },
  });
  if (!program) throw new NotFoundError("programme");
  // Index (programId, kind, createdAt DESC) ; le sujet par clé primaire.
  const rows = await db().$queryRaw<FinalDeckRow[]>`
    SELECT d."id", d."engine", d."themeId", t."name" AS "themeName", d."problem",
           CASE WHEN jsonb_typeof(d."spec" -> 'title') = 'string' THEN d."spec" ->> 'title' END AS "title",
           d."practice", d."createdAt"
    FROM "Deck" d
    LEFT JOIN "Theme" t ON t."id" = d."themeId"
    WHERE d."programId" = ${programId} AND d."kind" = 'FINAL' AND d."deletedAt" IS NULL
    ORDER BY d."createdAt" DESC, d."id" DESC
    LIMIT ${FINAL_DECKS_LIMIT}`;

  return rows.flatMap((raw) => {
    const parsed = FinalDeckRowSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn("deck.list.invalid_row", { programId, deckId: raw.id, issues: z.prettifyError(parsed.error) });
      return [];
    }
    const r = parsed.data;
    const engine = r.engine === null ? null : DeckEngineSchema.safeParse(r.engine);
    if (engine && !engine.success) {
      log.warn("deck.list.unknown_engine", { programId, deckId: r.id, engine: r.engine });
    }
    return [
      {
        id: r.id,
        engine: engine?.success ? engine.data : null,
        themeId: r.themeId,
        themeName: r.themeName,
        problem: r.problem ?? "",
        title: r.title,
        practice: r.practice,
        createdAt: r.createdAt,
      },
    ];
  });
}
