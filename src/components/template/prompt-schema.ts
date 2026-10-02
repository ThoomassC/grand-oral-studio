import { z } from "zod";

/** Longueur maximale des consignes analysées (celle du serveur). */
export const PROMPT_MAX_CHARS = 20_000;

/**
 * Miroir client de `TemplatePromptInputSchema` (src/server/services/imports.ts) :
 * mêmes règles, mêmes messages. Le module serveur n'est pas importable ici (il
 * tire le dépôt et Prisma) ; le serveur revalide de toute façon, et ses
 * `fieldErrors.text` s'affichent au même endroit.
 */
export const PromptTextSchema = z.object({
  text: z
    .string({ message: "Collez les consignes à analyser." })
    .max(PROMPT_MAX_CHARS, { message: `Les consignes ne doivent pas dépasser ${PROMPT_MAX_CHARS} caractères.` })
    .refine((s) => s.trim().length > 0, { message: "Collez les consignes à analyser." }),
});
