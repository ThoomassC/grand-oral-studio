import type { ThemeRef } from "@/domain/contracts";
import { fallbackJuryQuestions, JuryQuestionsSchema, type JuryQuestions } from "@/domain/jury-questions";
import type { DeckSpec, PromptTemplate } from "@/domain/schemas";
import { buildJuryQuestionsPrompt } from "@/domain/task-prompts";
import type { AiProvider, CallOptions, ResolvedEngine } from "../ai";
import { AiInvalidOutputError } from "../errors";
import { getQuestionContext, replaceQuestions, type QuestionView } from "../repo/questions";
import type { DeckEngine } from "../repo/types";
import { singleFlight } from "../single-flight";

/**
 * Préparation des questions probables du jury d'un diaporama.
 *
 * Ordre des opérations (aucun appel lent dans une transaction) :
 *  1. lecture du diaporama et de son sujet, droit d'éditeur (404 / 403) ;
 *  2. génération par un `JuryQuestionsGenerator`, HORS transaction ;
 *  3. validation de la sortie (JuryQuestionsSchema), puis remplacement des
 *     questions sous verrou, droit revérifié.
 *
 * Deux générateurs : l'IA du rédacteur de l'utilisateur (`aiJuryQuestionsGenerator`,
 * tâche structurée « juryQuestions ») et le repli sans IA
 * (`fallbackJuryQuestionsGenerator`), retenu SEULEMENT pour un utilisateur en
 * Sans IA (`juryQuestionsGeneratorFor`) : une erreur IA remonte telle quelle,
 * jamais de bascule silencieuse. L'action est responsable du quota (IA :
 * consumeAiQuotaFor selon la facturation ; sans IA : consumeFreeEngineQuota) et
 * la page porte `maxDuration = 300`.
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

/** Ce que le prompt IA demande en plus du diaporama et du sujet. */
export interface JuryPromptContext {
  /** Problématique du diaporama ("" si inconnue). */
  problem: string;
  language: PromptTemplate["language"];
}

/**
 * Questions rédigées par une IA (tâche structurée « juryQuestions »). Le
 * fournisseur valide déjà sa sortie ; le service la revalide quand même.
 */
export function aiJuryQuestionsGenerator(
  ai: AiProvider,
  engine: Exclude<DeckEngine, "free">,
  context: JuryPromptContext,
  options?: CallOptions,
): JuryQuestionsGenerator {
  return {
    engine,
    generate: ({ spec, subject }) =>
      ai.generateStructured(
        {
          task: "juryQuestions",
          prompt: buildJuryQuestionsPrompt({ spec, subject, problem: context.problem, language: context.language }),
          hints: { spec, subject },
        },
        options,
      ),
  };
}

/** Générateur du rédacteur de l'utilisateur : sans IA seulement s'il a choisi Sans IA. */
export function juryQuestionsGeneratorFor(
  resolved: ResolvedEngine,
  context: JuryPromptContext,
  options?: CallOptions,
): JuryQuestionsGenerator {
  if (resolved.engine === "free") return fallbackJuryQuestionsGenerator;
  return aiJuryQuestionsGenerator(resolved.provider, resolved.engine, context, options);
}

export interface GeneratedJuryQuestions {
  programId: string;
  engine: DeckEngine;
  questions: QuestionView[];
}

/**
 * Rejouable : deux demandes simultanées du même utilisateur sur le même
 * diaporama n'en font qu'une (singleFlight, par instance) — un double-clic ne
 * paie pas deux appels IA.
 */
export async function generateJuryQuestions(
  userId: string,
  deckId: string,
  deps: { generator?: JuryQuestionsGenerator } = {},
): Promise<GeneratedJuryQuestions> {
  const generator = deps.generator ?? fallbackJuryQuestionsGenerator;
  return singleFlight(`jury:${userId}:${deckId}`, async () => {
    const { spec, subject } = await getQuestionContext(userId, deckId);
    const output = JuryQuestionsSchema.safeParse(await generator.generate({ spec, subject }));
    if (!output.success) throw new AiInvalidOutputError(`juryQuestions (${generator.engine}) : sortie hors schéma`);
    const { programId, questions } = await replaceQuestions(userId, deckId, output.data.questions);
    return { programId, engine: generator.engine, questions };
  });
}
