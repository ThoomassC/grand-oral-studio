/**
 * Règle « prêt pour le jour J » (v1.2) : au moins 2 diaporamas (entraînement et
 * jour J confondus) ET au moins 2 répétitions chronométrées. Fonction pure,
 * destinée à remplacer le critère « 1 diaporama final » de progress.ts.
 */

export const READY_MIN_DECKS = 2;
export const READY_MIN_REHEARSALS = 2;

export interface ReadinessCounts {
  /** Diaporamas non supprimés du projet, entraînement compris. */
  decks: number;
  /** Répétitions enregistrées sur ces diaporamas. */
  rehearsals: number;
}

/** Un compteur non fini ou négatif ne compte pas. */
function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function isExamReady(counts: ReadinessCounts): boolean {
  return count(counts.decks) >= READY_MIN_DECKS && count(counts.rehearsals) >= READY_MIN_REHEARSALS;
}
