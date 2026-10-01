import { revalidatePath } from "next/cache";

/**
 * Invalidation après mutation. Convention de routes attendue côté pages :
 * liste en /programmes, tout le reste d'un programme sous /programmes/<id>/**.
 * `"layout"` sur le chemin littéral du programme invalide aussi ses sous-pages
 * (thèmes, charte, gabarit, jour J, decks).
 */
export function revalidatePrograms(programId?: string): void {
  revalidatePath("/programmes");
  if (programId) revalidatePath(`/programmes/${programId}`, "layout");
}
