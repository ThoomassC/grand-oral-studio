/**
 * Avertissements d'une génération du jour J, transmis à la page du diaporama
 * par sessionStorage (`grand-oral-studio:deck-notice:<deckId>`) : écrits par
 * DayJourney juste avant la navigation, lus puis effacés par DeckNotice.
 */

export function deckNoticeKey(deckId: string): string {
  return `grand-oral-studio:deck-notice:${deckId}`;
}

export interface DeckNoticeData {
  warnings: string[];
}

const MAX_WARNINGS = 20;
const MAX_WARNING_LENGTH = 600;

export function serializeDeckNotice(data: DeckNoticeData): string {
  return JSON.stringify({ v: 1, warnings: data.warnings });
}

/** Relit la valeur stockée ; null si elle est absente, illisible ou vide. Ne lève jamais. */
export function parseDeckNotice(raw: string | null): DeckNoticeData | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { v, warnings } = value as { v?: unknown; warnings?: unknown };
  if (v !== 1 || !Array.isArray(warnings)) return null;
  const kept = warnings
    .filter((w): w is string => typeof w === "string" && w.trim() !== "")
    .slice(0, MAX_WARNINGS)
    .map((w) => w.slice(0, MAX_WARNING_LENGTH));
  return kept.length > 0 ? { warnings: kept } : null;
}

/** Range les avertissements (aucun : rien n'est écrit). Stockage indisponible : ignoré. */
export function storeDeckNotice(deckId: string, warnings: readonly string[]): void {
  if (warnings.length === 0) return;
  try {
    window.sessionStorage.setItem(deckNoticeKey(deckId), serializeDeckNotice({ warnings: [...warnings] }));
  } catch {
    // Navigation privée, quota : les avertissements sont perdus, le diaporama reste intact.
  }
}
