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

/** Mêmes bornes que Better Auth (minPasswordLength 10, maxPasswordLength 128, src/lib/auth.ts). */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/** Changement de mot de passe (le serveur Better Auth revérifie tout, dont le mot de passe actuel). */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Saisissez votre mot de passe actuel.")
      .max(MAX_PASSWORD_LENGTH, `Le mot de passe ne doit pas dépasser ${MAX_PASSWORD_LENGTH} caractères.`),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`)
      .max(MAX_PASSWORD_LENGTH, `Le mot de passe ne doit pas dépasser ${MAX_PASSWORD_LENGTH} caractères.`),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Le nouveau mot de passe doit être différent de l'actuel.",
  });

export type ChangePasswordInput = z.input<typeof ChangePasswordSchema>;

/** Suppression du compte : l'adresse du compte, recopiée (vérifiée aussi côté serveur). */
export const DeleteAccountSchema = z.object({
  confirmEmail: z.string().trim().min(1, "Recopiez votre adresse e-mail.").max(320),
});

export type DeleteAccountInput = z.input<typeof DeleteAccountSchema>;

/** L'adresse recopiée désigne-t-elle le compte ? (espaces et casse ignorés) */
export function confirmsAccountEmail(typed: string, accountEmail: string): boolean {
  return typed.trim().toLowerCase() === accountEmail.trim().toLowerCase();
}
