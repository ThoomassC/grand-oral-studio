import { z } from "zod";

/** Longueur maximale du texte analysé (celle du serveur). */
export const THEME_PROMPT_MAX_CHARS = 20_000;

/**
 * Miroir client de `ThemePromptInputSchema` (src/server/services/imports.ts) :
 * mêmes règles, mêmes messages. Le module serveur n'est pas importable ici (il
 * tire le dépôt et Prisma) ; l'action revalide de toute façon, et ses
 * `fieldErrors.text` s'affichent au même endroit.
 */
export const ThemePromptTextSchema = z.object({
  text: z
    .string({ message: "Collez le texte décrivant votre oral." })
    .max(THEME_PROMPT_MAX_CHARS, { message: `Le texte ne doit pas dépasser ${THEME_PROMPT_MAX_CHARS} caractères.` })
    .refine((s) => s.trim().length > 0, { message: "Collez le texte décrivant votre oral." }),
});
