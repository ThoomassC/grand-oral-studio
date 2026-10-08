import { z } from "zod";
import { JURY_LIMITS, JuryQuestionsSchema } from "@/domain/jury-questions";
import { normalizeSlide, RawSlideSchema, truncateText } from "@/domain/normalize";
import { SlideSchema, stripControlChars } from "@/domain/schemas";
import { checkShape, strict, type ParseOptions } from "./structured";
import type { StructuredResults, StructuredTask } from "./types";

/**
 * Tâches structurées ponctuelles, communes à tous les fournisseurs : schéma
 * PERMISSIF envoyé au modèle (forme seule), puis normalisation dans les bornes
 * du domaine et validation stricte — même chaîne que le deck (cf.
 * src/domain/normalize.ts).
 */

/** Racine objet : exigée par les sorties json_schema. */
export const RawJuryQuestionsSchema = z.object({
  questions: z.array(z.object({ question: z.string(), answer: z.string() })),
});

export interface TaskSpec<T extends StructuredTask> {
  /** Nom du schéma envoyé au fournisseur (lettres, chiffres, « _ »). */
  name: string;
  raw: z.ZodType;
  maxTokens: number;
  /** JSON reçu → résultat validé ; lève AiInvalidOutputError. */
  finish(json: unknown, options?: ParseOptions): StructuredResults[T];
}

function clean(value: string): string {
  return stripControlChars(value).replace(/[ \t]+/g, " ").trim();
}

const juryQuestions: TaskSpec<"juryQuestions"> = {
  name: "jury_questions",
  raw: RawJuryQuestionsSchema,
  maxTokens: 8_000,
  finish(json, options) {
    const raw = checkShape("juryQuestions", json, RawJuryQuestionsSchema, options);
    const questions = raw.questions
      .map((q) => ({ question: truncateText(clean(q.question), JURY_LIMITS.question), answer: truncateText(clean(q.answer), JURY_LIMITS.answer) }))
      .filter((q) => q.question.length > 0 && q.answer.length > 0)
      .slice(0, JURY_LIMITS.maxQuestions);
    return strict("juryQuestions", JuryQuestionsSchema, { questions });
  },
};

const slide: TaskSpec<"slide"> = {
  name: "slide",
  raw: RawSlideSchema,
  maxTokens: 4_000,
  finish(json, options) {
    const raw = checkShape("slide", json, RawSlideSchema, options);
    // Index 1 : une diapo isolée n'est jamais présumée être la couverture.
    return strict("slide", SlideSchema, normalizeSlide(raw, 1));
  },
};

export const STRUCTURED_TASKS: { readonly [T in StructuredTask]: TaskSpec<T> } = { juryQuestions, slide };
