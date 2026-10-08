"use server";

import type { z } from "zod";
import type { ClassificationOutcome } from "@/domain/contracts";
import { ProblemInputSchema } from "@/domain/schemas";
import { getEngineForUser, type EngineOverride } from "../ai";
import { isAppError } from "../errors";
import * as service from "../services/generation";
import { boundPrepStartedAt, GenerationOptionsSchema, IdSchema, parseInput, type GenerationOptionsInput } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction, type ActionContext } from "./run";

type ProblemFormInput = z.input<typeof ProblemInputSchema>;

/**
 * Moteur de l'utilisateur (sa préférence, sinon la clé d'équipe Mistral ou
 * Gemini, sinon Sans IA : cf. src/server/ai/engine.ts), ou le choix ponctuel
 * `override` (repli en un clic). Un moteur choisi mais indisponible lève une
 * erreur qui renvoie vers la Rédaction IA : pas de bascule silencieuse.
 */
async function deps(ctx: ActionContext, override: EngineOverride | null = null): Promise<service.GenerationDeps> {
  const resolved = await getEngineForUser(ctx.user.id, { log: ctx.log, override });
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
  return runAction(
    "classifyProblem",
    async (ctx) => {
      const id = parseInput(IdSchema, programId);
      const problem = parseInput(ProblemInputSchema, input);
      return service.classifyProblem(ctx.user.id, id, problem, await classifyDeps(ctx));
    },
    { exposeCode: true },
  );
}

/** Sujet retenu le jour J : un identifiant, ou null explicite pour un deck sans sujet. */
const SubjectIdSchema = IdSchema.nullable();

export type { GenerationOptionsInput };

/**
 * Jour J, étape 2 : deck final pour le sujet retenu, ou sans sujet (`themeId`
 * null : problématique et trame seules). Rejouable sans doublon (cf. service).
 * Options : `practice` (diaporama d'entraînement), `prepStartedAt` (départ du
 * chrono, ISO ; hors bornes → ignoré), `override` (rédacteur ponctuel du repli
 * en un clic ; inutilisable → erreur, jamais de bascule). Un échec porte son
 * `code` : l'interface en déduit les replis à proposer.
 */
export async function generateFinalDeck(
  programId: string,
  themeId: string | null,
  problem: string,
  options: GenerationOptionsInput = {},
): Promise<ActionResult<service.FinalDeckResult>> {
  return runAction(
    "generateFinalDeck",
    async (ctx) => {
      const pid = parseInput(IdSchema, programId);
      const tid = parseInput(SubjectIdSchema, themeId);
      const { problem: text } = parseInput(ProblemInputSchema, { problem });
      const opts = parseInput(GenerationOptionsSchema, options);
      const prepStartedAt = boundPrepStartedAt(opts.prepStartedAt, new Date());
      if (opts.prepStartedAt !== null && prepStartedAt === null) ctx.log.warn("generation.prep_started_ignored", {});
      const result = await service.generateFinalDeck(
        ctx.user.id,
        { programId: pid, themeId: tid, problem: text, practice: opts.practice, prepStartedAt },
        await deps(ctx, opts.override),
      );
      revalidatePrograms(pid);
      return result;
    },
    { exposeCode: true },
  );
}
