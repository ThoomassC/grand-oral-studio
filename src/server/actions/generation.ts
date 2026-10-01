"use server";

import type { z } from "zod";
import type { ClassificationResult } from "@/domain/contracts";
import { ProblemInputSchema } from "@/domain/schemas";
import { getAiProvider } from "../ai";
import * as service from "../services/generation";
import { IdSchema, parseInput } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction, type ActionContext } from "./run";

type ProblemFormInput = z.input<typeof ProblemInputSchema>;

const deps = (ctx: ActionContext): service.GenerationDeps => ({ ai: getAiProvider(), log: ctx.log });

/** Génère (ou régénère) le squelette d'un thème. Rejouable : un seul squelette par thème. */
export async function generateSkeleton(themeId: string): Promise<ActionResult<service.SkeletonResult>> {
  return runAction("generateSkeleton", async (ctx) => {
    const id = parseInput(IdSchema, themeId);
    const result = await service.generateSkeleton(ctx.user.id, id, deps(ctx));
    revalidatePrograms();
    return result;
  });
}

/** Squelettes de tous les thèmes (3 en parallèle au plus) ; résultat par thème. */
export async function generateAllSkeletons(programId: string): Promise<ActionResult<service.BatchItemResult[]>> {
  return runAction("generateAllSkeletons", async (ctx) => {
    const id = parseInput(IdSchema, programId);
    const results = await service.generateAllSkeletons(ctx.user.id, id, deps(ctx));
    revalidatePrograms(id);
    return results;
  });
}

/** Jour J, étape 1 : reconnaissance du thème (top 3). Aucune écriture. */
export async function classifyProblem(
  programId: string,
  input: ProblemFormInput,
): Promise<ActionResult<ClassificationResult>> {
  return runAction("classifyProblem", async (ctx) => {
    const id = parseInput(IdSchema, programId);
    const problem = parseInput(ProblemInputSchema, input);
    return service.classifyProblem(ctx.user.id, id, problem, deps(ctx));
  });
}

/** Jour J, étape 2 : deck final pour le thème confirmé (s'appuie sur son squelette s'il existe). */
export async function generateFinalDeck(
  programId: string,
  themeId: string,
  problem: string,
): Promise<ActionResult<{ deckId: string }>> {
  return runAction("generateFinalDeck", async (ctx) => {
    const pid = parseInput(IdSchema, programId);
    const tid = parseInput(IdSchema, themeId);
    const { problem: text } = parseInput(ProblemInputSchema, { problem });
    const { deckId } = await service.generateFinalDeck(
      ctx.user.id,
      { programId: pid, themeId: tid, problem: text },
      deps(ctx),
    );
    revalidatePrograms(pid);
    return { deckId };
  });
}
