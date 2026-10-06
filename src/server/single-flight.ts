/**
 * Coalescence des appels concurrents identiques au sein d'un process : un
 * double-clic ou un retry client pendant qu'une génération est en cours
 * partage la même promesse au lieu de payer un second appel IA.
 *
 * Limite assumée : par instance. La garantie inter-instances repose sur la
 * base (déduplication des decks finaux récents, cf. `findRecentFinalDeck`).
 */

const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
