import { z } from "zod";

/**
 * Miroir client de `ProgramMetaSchema` (src/server/validation.ts) : mêmes
 * bornes, mêmes messages. Le module serveur n'est pas importable ici ;
 * l'action `updateProgram` revalide de toute façon, et ses `fieldErrors`
 * s'affichent au même endroit.
 */
export const PROGRAM_NAME_MAX = 120;
export const PROGRAM_DESCRIPTION_MAX = 2000;

export const ProgramMetaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Le nom du projet doit faire au moins 2 caractères.")
    .max(PROGRAM_NAME_MAX, `Le nom du projet ne doit pas dépasser ${PROGRAM_NAME_MAX} caractères.`),
  description: z
    .string()
    .trim()
    .max(PROGRAM_DESCRIPTION_MAX, `La description ne doit pas dépasser ${PROGRAM_DESCRIPTION_MAX} caractères.`),
});

export type ProgramMetaValues = z.output<typeof ProgramMetaSchema>;
