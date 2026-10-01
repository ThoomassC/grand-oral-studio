/** Résultat uniforme des Server Actions (sérialisable, sans exception côté client). */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
