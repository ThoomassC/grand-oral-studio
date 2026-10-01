import { z } from "zod";

/** Nom affiché du compte : même règle à la saisie (client) et dans l'action serveur. */
export const ProfileNameSchema = z.object({
  name: z
    .string({ error: "Indiquez votre nom." })
    .trim()
    .min(2, "Indiquez votre nom (2 caractères au moins).")
    .max(80, "Le nom ne doit pas dépasser 80 caractères."),
});

export type ProfileNameInput = z.input<typeof ProfileNameSchema>;
