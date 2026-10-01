import { z } from "zod";
import { fr } from "zod/locales";

// Messages zod en français côté client aussi (le serveur fait de même dans src/server/validation.ts).
z.config(fr());

export type FieldErrors = Record<string, string[]>;

/**
 * Valide `value` avec le même schéma que la Server Action, et produit des
 * erreurs indexées par chemin pointé ("sections.2.title"), format identique
 * aux `fieldErrors` renvoyés par le serveur.
 */
export function validateWith<S extends z.ZodType>(
  schema: S,
  value: unknown,
): { ok: true; data: z.output<S> } | { ok: false; fieldErrors: FieldErrors } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, fieldErrors };
}

/** Premier message d'erreur d'un champ, ou undefined. */
export function firstError(errors: FieldErrors | undefined, key: string): string | undefined {
  return errors?.[key]?.[0];
}

/** Props ARIA d'un champ en erreur : `aria-invalid` + `aria-describedby` vers le message. */
export function errorProps(
  errors: FieldErrors | undefined,
  key: string,
  errorId: string,
  hintId?: string,
): { "aria-invalid": boolean; "aria-describedby": string | undefined } {
  const hasError = Boolean(firstError(errors, key));
  const ids = [hintId, hasError ? errorId : undefined].filter(Boolean).join(" ");
  return { "aria-invalid": hasError, "aria-describedby": ids || undefined };
}
