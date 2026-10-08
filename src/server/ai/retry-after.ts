/** Attente annoncée par un fournisseur d'IA (en-tête Retry-After), partagée par tous les fournisseurs. */

const DEFAULT_RETRY_AFTER_S = 60;
const MAX_RETRY_AFTER_S = 3_600;

/** Retry-After en secondes (entier ou date HTTP), borné ; défaut 60 s. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  const raw = header?.trim();
  let seconds = Number.NaN;
  if (raw) {
    if (/^\d+$/.test(raw)) seconds = Number(raw);
    else {
      const at = Date.parse(raw);
      if (Number.isFinite(at)) seconds = Math.ceil((at - now) / 1000);
    }
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_S;
  return Math.min(MAX_RETRY_AFTER_S, Math.max(1, Math.round(seconds)));
}
