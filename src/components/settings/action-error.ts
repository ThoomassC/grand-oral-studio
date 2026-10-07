/**
 * Message d'échec d'une action de la page Rédaction IA. Les messages typés du
 * serveur (clé refusée, crédit épuisé, quota) sont affichés tels quels ; quand
 * l'échec précise une attente (`retryAfterSeconds`, quota 429), « Réessayez
 * dans 2 min » devient l'heure à laquelle réessayer : « Réessayez à 14:32 ».
 */

export interface ActionFailure {
  error: string;
  /** Attente avant de réessayer, si le serveur la précise. */
  retryAfterSeconds?: number;
}

const timeFormatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Heure (HH:MM, fuseau du navigateur) à partir de laquelle réessayer : arrondie à la minute suivante. */
export function retryTime(retryAfterSeconds: number, now: Date): string {
  const minute = 60_000;
  return timeFormatter.format(new Date(Math.ceil((now.getTime() + retryAfterSeconds * 1000) / minute) * minute));
}

export function failureMessage(failure: ActionFailure, now: Date = new Date()): string {
  const wait = failure.retryAfterSeconds;
  if (typeof wait !== "number" || !Number.isFinite(wait) || wait <= 0) return failure.error;
  const at = retryTime(wait, now);
  const replaced = failure.error.replace(/Réessayez dans [^.,;]+/, `Réessayez à ${at}`);
  return replaced !== failure.error ? replaced : `${failure.error} Réessayez à ${at}.`;
}
