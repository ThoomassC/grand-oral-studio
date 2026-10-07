import type { AppErrorCode } from "../errors";

/**
 * Résultat uniforme des Server Actions (sérialisable, sans exception côté client).
 * `code` : nature de l'erreur attendue, pour les actions qui l'exposent (le jour J
 * s'en sert pour proposer un repli) ; absent pour une panne.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: AppErrorCode; fieldErrors?: Record<string, string[]> };
