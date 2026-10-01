/**
 * Place le focus sur le premier élément trouvé parmi `ids`, une fois le DOM
 * mis à jour (le rendu consécutif à une Server Action peut arriver après la
 * résolution de la promesse) : nouvelles tentatives pendant ~1,5 s.
 */
export function focusLater(ids: (string | null | undefined)[], options: { select?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  let attempts = 0;
  const tryFocus = () => {
    attempts += 1;
    for (const id of ids) {
      if (!id) continue;
      const el = document.getElementById(id);
      if (el && !el.hasAttribute("hidden") && el.getClientRects().length > 0) {
        el.focus();
        if (options.select && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.select();
        return;
      }
    }
    if (attempts < 20) window.setTimeout(tryFocus, 80);
  };
  window.setTimeout(tryFocus, 0);
}

/**
 * Focalise le premier champ en erreur d'un formulaire, dans l'ordre du DOM
 * (ce n'est pas forcément le premier champ du formulaire).
 */
export function focusFirstInvalid(form: HTMLElement | null): void {
  if (!form) return;
  let attempts = 0;
  const tryFocus = () => {
    attempts += 1;
    const el = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (el) el.focus();
    else if (attempts < 6) window.setTimeout(tryFocus, 60);
  };
  window.setTimeout(tryFocus, 0);
}

/** « 1 champ à corriger », « 3 champs à corriger ». */
export function invalidCountMessage(count: number, action = "d'enregistrer"): string {
  return count <= 1 ? `1 champ est à corriger avant ${action}.` : `${count} champs sont à corriger avant ${action}.`;
}

/** Nombre de champs distincts en erreur (les sous-chemins « a.0 » comptent pour « a.0 »). */
export function countFieldErrors(errors: Record<string, unknown>): number {
  return Object.keys(errors).filter((k) => k !== "_form").length;
}
