"use server";

import type { z } from "zod";
import type { ClassificationOutcome } from "@/domain/contracts";
import { ProblemInputSchema } from "@/domain/schemas";
import { getEngineForUser } from "../ai";
import { isAppError } from "../errors";
import * as service from "../services/generation";
import { IdSchema, parseInput } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction, type ActionContext } from "./run";

type ProblemFormInput = z.input<typeof ProblemInputSchema>;

/**
 * Moteur de l'utilisateur (sa préférence, sinon Claude s'il a une clé, sinon
 * gratuit). Un moteur choisi mais indisponible lève une erreur qui renvoie vers
 * la Configuration IA : pas de bascule silencieuse.
 */
async function deps(ctx: ActionContext): Promise<service.GenerationDeps> {
  const resolved = await getEngineForUser(ctx.user.id, { log: ctx.log });
  if (resolved.engine === "free") return { mode: "free", log: ctx.log };
  return { ai: resolved.provider, log: ctx.log, billing: resolved.billing };
}

/**
 * Pour la reconnaissance du jour J seulement : si le moteur choisi est
 * indisponible, la reconnaissance sans IA (gratuite, instantanée) répond quand
 * même, avec l'explication. Aucun moteur payant n'est substitué.
 */
async function classifyDeps(ctx: ActionContext): Promise<service.GenerationDeps> {
  try {
    return await deps(ctx);
  } catch (error) {
    if (!isAppError(error)) throw error;
    ctx.log.warn("classify.engine_unavailable", { code: error.code });
    return { mode: "free", log: ctx.log, fallbackReason: error.userMessage };
  }
}

/** Jour J, étape 1 : reconnaissance du sujet (top 3). Aucune écriture. */
export async function classifyProblem(
  programId: string,
  input: ProblemFormInput,
): Promise<ActionResult<ClassificationOutcome>> {
  return runAction("classifyProblem", async (ctx) => {
    const id = parseInput(IdSchema, programId);
    const problem = parseInput(ProblemInputSchema, input);
    return service.classifyProblem(ctx.user.id, id, problem, await classifyDeps(ctx));
  });
}

/** Sujet retenu le jour J : un identifiant, ou null explicite pour un deck sans sujet. */
const SubjectIdSchema = IdSchema.nullable();

/**
 * Jour J, étape 2 : deck final pour le sujet retenu, ou sans sujet (`themeId`
 * null : problématique et trame seules). Rejouable sans doublon (cf. service).
 */
export async function generateFinalDeck(
  programId: string,
  themeId: string | null,
  problem: string,
): Promise<ActionResult<{ deckId: string }>> {
  return runAction("generateFinalDeck", async (ctx) => {
    const pid = parseInput(IdSchema, programId);
    const tid = parseInput(SubjectIdSchema, themeId);
    const { problem: text } = parseInput(ProblemInputSchema, { problem });
    const { deckId } = await service.generateFinalDeck(
      ctx.user.id,
      { programId: pid, themeId: tid, problem: text },
      await deps(ctx),
    );
    revalidatePrograms(pid);
    return { deckId };
  });
}
