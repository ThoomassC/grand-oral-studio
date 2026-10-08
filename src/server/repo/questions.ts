import type { ThemeRef } from "@/domain/contracts";
import { JuryQuestionsSchema, type JuryQuestion } from "@/domain/jury-questions";
import { DeckSpecSchema, type DeckSpec } from "@/domain/schemas";
import { db } from "../db/client";
import { ForbiddenError, NotFoundError } from "../errors";
import { assertWritable, parseStored } from "../validation";
import { hasRole, liveDeck, lockDeckFor, memberRoleOf, programAccess, roleOf } from "./access";

/**
 * Questions probables du jury d'un diaporama. Préparées (et remplacées en bloc)
 * par un ÉDITEUR ; lues et marquées par chacun, LECTEUR compris : le statut
 * « Je sais répondre » / « À revoir » est propre à chaque utilisateur
 * (DeckQuestionReview, clé (questionId, userId)). Remplacer les questions efface
 * leurs statuts (cascade), supprimer le diaporama efface tout.
 */

/** Statut d'une question pour un utilisateur ; null : pas encore marquée. */
export type ReviewStatus = "known" | "to_review";

/** Valeurs stockées (CHECK DeckQuestionReview_status_known). */
const STORED_STATUS: Record<ReviewStatus, "KNOWN" | "TO_REVIEW"> = { known: "KNOWN", to_review: "TO_REVIEW" };

function readStatus(stored: string | undefined): ReviewStatus | null {
  if (stored === "KNOWN") return "known";
  if (stored === "TO_REVIEW") return "to_review";
  return null;
}

export interface QuestionView {
  id: string;
  question: string;
  answer: string;
  /** Statut de l'utilisateur qui lit. */
  status: ReviewStatus | null;
}

const questionSelect = (userId: string) =>
  ({
    id: true,
    question: true,
    answer: true,
    reviews: { where: { userId }, select: { status: true }, take: 1 },
  }) as const;

function toView(row: { id: string; question: string; answer: string; reviews: { status: string }[] }): QuestionView {
  return { id: row.id, question: row.question, answer: row.answer, status: readStatus(row.reviews[0]?.status) };
}

/** Questions du diaporama, dans l'ordre, avec le statut de `userId` (lecteur et plus ; sinon 404). */
export async function getQuestions(userId: string, deckId: string): Promise<QuestionView[]> {
  const deck = await db().deck.findFirst({
    where: { id: deckId, ...liveDeck, program: programAccess(userId, "viewer") },
    select: { questions: { orderBy: { position: "asc" }, select: questionSelect(userId) } },
  });
  if (!deck) throw new NotFoundError("deck");
  return deck.questions.map(toView);
}

export interface QuestionContext {
  programId: string;
  spec: DeckSpec;
  /** Sujet du diaporama (notes et mots-clés compris), ou null : diaporama sans sujet. */
  subject: ThemeRef | null;
}

/**
 * Ce qu'il faut pour préparer les questions : le diaporama et son sujet. Droit
 * d'ÉDITEUR, vérifié en une lecture : inconnu → 404, lecteur → 403. Lecture hors
 * transaction : la génération (IA demain) se fait entre cette lecture et
 * l'écriture, qui revérifie le droit sous verrou.
 */
export async function getQuestionContext(userId: string, deckId: string): Promise<QuestionContext> {
  const row = await db().deck.findFirst({
    where: { id: deckId, ...liveDeck, program: programAccess(userId, "viewer") },
    select: {
      programId: true,
      spec: true,
      theme: { select: { id: true, name: true, description: true, keywords: true, notes: true } },
      program: { select: { ownerId: true, members: memberRoleOf(userId) } },
    },
  });
  const role = row ? roleOf(userId, row.program.ownerId, row.program.members[0]?.role) : null;
  if (!row || !role) throw new NotFoundError("deck");
  if (!hasRole(role, "editor")) throw new ForbiddenError();
  return {
    programId: row.programId,
    spec: parseStored(DeckSpecSchema, row.spec, "Deck.spec", deckId),
    subject: row.theme,
  };
}

/**
 * Remplace toutes les questions du diaporama (éditeur), positions 0..n-1 dans
 * l'ordre donné. Sous verrou du deck : deux remplacements concurrents, ou un
 * marquage pendant un remplacement, ne s'entremêlent pas.
 */
export async function replaceQuestions(
  userId: string,
  deckId: string,
  items: readonly JuryQuestion[],
): Promise<{ programId: string; questions: QuestionView[] }> {
  const { questions: valid } = assertWritable(JuryQuestionsSchema, { questions: items }, "DeckQuestion");
  return db().$transaction(async (tx) => {
    const { programId } = await lockDeckFor(tx, userId, deckId, "editor");
    await tx.deckQuestion.deleteMany({ where: { deckId } });
    const created = await tx.deckQuestion.createManyAndReturn({
      data: valid.map((q, position) => ({ deckId, position, question: q.question, answer: q.answer })),
      select: { id: true, position: true, question: true, answer: true },
    });
    const questions = [...created]
      .sort((a, b) => a.position - b.position)
      .map((q): QuestionView => ({ id: q.id, question: q.question, answer: q.answer, status: null }));
    return { programId, questions };
  });
}

/**
 * Marque une question pour `userId` (lecteur et plus). Le deck de la question est
 * verrouillé sous condition d'accès : question absente, deck invisible ou
 * étranger → 404 (indistinguables).
 */
export async function setReview(
  userId: string,
  questionId: string,
  status: ReviewStatus,
): Promise<{ programId: string; deckId: string; status: ReviewStatus }> {
  const question = await db().deckQuestion.findUnique({ where: { id: questionId }, select: { deckId: true } });
  if (!question) throw new NotFoundError("deck");
  const { deckId } = question;
  return db().$transaction(async (tx) => {
    const { programId } = await lockDeckFor(tx, userId, deckId, "viewer");
    // Question remplacée entre la lecture et le verrou : elle n'existe plus.
    const still = await tx.deckQuestion.count({ where: { id: questionId, deckId } });
    if (still === 0) throw new NotFoundError("deck");
    const stored = STORED_STATUS[status];
    await tx.deckQuestionReview.upsert({
      where: { questionId_userId: { questionId, userId } },
      create: { questionId, userId, status: stored },
      update: { status: stored },
      select: { questionId: true },
    });
    return { programId, deckId, status };
  });
}
