import type { ThemeRef } from "@/domain/contracts";
import { fallbackJuryQuestions, JuryQuestionsSchema, type JuryQuestions } from "@/domain/jury-questions";
import type { DeckSpec } from "@/domain/schemas";
import { AiInvalidOutputError } from "../errors";
import { getQuestionContext, replaceQuestions, type QuestionView } from "../repo/questions";
import type { DeckEngine } from "../repo/types";

/**
 * Préparation des questions probables du jury d'un diaporama.
 *
 * Ordre des opérations (aucun appel lent dans une transaction) :
 *  1. lecture du diaporama et de son sujet, droit d'éditeur (404 / 403) ;
 *  2. génération par un `JuryQuestionsGenerator`, HORS transaction ;
 *  3. validation de la sortie (JuryQuestionsSchema), puis remplacement des
 *     questions sous verrou, droit revérifié.
 *
 * Pour l'instant seul le repli sans IA (`fallbackJuryQuestionsGenerator`) existe.
 *
 * POINT D'EXTENSION IA : écrire un `JuryQuestionsGenerator` qui appelle
 * `provider.generateStructured({ task: "juryQuestions", … }, { budgetMs })` et
 * renvoie l'objet `{ questions }` (racine objet exigée par les sorties
 * structurées), puis le passer en `deps.generator` depuis l'action. L'action reste
 * responsable du quota (IA : consumeAiQuotaFor selon la facturation ; sans IA :
 * consumeFreeEngineQuota) et la page porte déjà `maxDuration = 300`.
 */

export interface JuryQuestionsInput {
  spec: DeckSpec;
  subject: ThemeRef | null;
}

export type JuryQuestionsGenerator = {
  /** Moteur annoncé à l'utilisateur (« free » : sans IA). */
  readonly engine: DeckEngine;
  /** Produit les questions ; la sortie est revalidée par le service (une IA peut se tromper de format). */
  generate(input: JuryQuestionsInput): Promise<JuryQuestions>;
};

/** Repli déterministe, sans IA : questions tirées du diaporama et des notes du sujet. */
export const fallbackJuryQuestionsGenerator: JuryQuestionsGenerator = {
  engine: "free",
  generate: async ({ spec, subject }) => ({ questions: fallbackJuryQuestions(spec, subject) }),
};

export interface GeneratedJuryQuestions {
  programId: string;
  engine: DeckEngine;
  questions: QuestionView[];
}

export async function generateJuryQuestions(
  userId: string,
  deckId: string,
  deps: { generator?: JuryQuestionsGenerator } = {},
): Promise<GeneratedJuryQuestions> {
  const generator = deps.generator ?? fallbackJuryQuestionsGenerator;
  const { spec, subject } = await getQuestionContext(userId, deckId);
  const output = JuryQuestionsSchema.safeParse(await generator.generate({ spec, subject }));
  if (!output.success) throw new AiInvalidOutputError(`juryQuestions (${generator.engine}) : sortie hors schéma`);
  const { programId, questions } = await replaceQuestions(userId, deckId, output.data.questions);
  return { programId, engine: generator.engine, questions };
}
