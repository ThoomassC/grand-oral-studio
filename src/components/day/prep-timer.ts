import { parsePrepState, remainingMs, storageKey } from "@/domain/prep-clock";

/**
 * Chronomètre de préparation côté navigateur : l'état persisté du domaine
 * (`{ v: 1, startedAt }`, cf. src/domain/prep-clock.ts) plus un instant de mise
 * en pause facultatif. Reprendre décale le départ de la durée de la pause : le
 * départ enregistré reste « l'instant où la préparation aurait commencé sans
 * pause », c'est lui qui part avec la génération (prepStartedAt).
 *
 * Fonctions pures (l'horloge est un paramètre), puis l'accès à localStorage
 * (abonnement inclus) : le décompte et le parcours du jour J vivent dans deux
 * îlots client distincts et se parlent par ce stockage.
 */

export interface PrepTimer {
  /** Départ (ms depuis l'époque), décalé des pauses passées. */
  startedAt: number;
  /** Instant de la mise en pause en cours ; null = le décompte tourne. */
  pausedAt: number | null;
}

/** Clé du chronomètre d'un projet ; l'entraînement a le sien (il ne consomme pas celui du jour J). */
export function prepStorageKey(programId: string, practice: boolean): string {
  return practice ? `${storageKey(programId)}:entrainement` : storageKey(programId);
}

export function serializePrepTimer(timer: PrepTimer): string {
  return JSON.stringify(
    timer.pausedAt === null ? { v: 1, startedAt: timer.startedAt } : { v: 1, startedAt: timer.startedAt, pausedAt: timer.pausedAt },
  );
}

/** Relit l'état ; null s'il est absent, illisible, dans le futur ou périmé (> 6 h). Ne lève jamais. */
export function parsePrepTimer(raw: string | null, now: number): PrepTimer | null {
  const state = parsePrepState(raw, now);
  if (!state || raw === null) return null;
  let pausedAt: number | null = null;
  try {
    const value: unknown = (JSON.parse(raw) as { pausedAt?: unknown }).pausedAt;
    // Une pause incohérente (avant le départ, dans le futur) est ignorée : le décompte tourne.
    if (typeof value === "number" && Number.isInteger(value) && value >= state.startedAt && value <= now) pausedAt = value;
  } catch {
    // parsePrepState a déjà lu ce JSON : inatteignable.
  }
  return { startedAt: state.startedAt, pausedAt };
}

export function pauseTimer(timer: PrepTimer, now: number): PrepTimer {
  return timer.pausedAt === null ? { ...timer, pausedAt: now } : timer;
}

export function resumeTimer(timer: PrepTimer, now: number): PrepTimer {
  if (timer.pausedAt === null) return timer;
  return { startedAt: timer.startedAt + Math.max(0, now - timer.pausedAt), pausedAt: null };
}

/** Temps restant, figé pendant une pause. */
export function timerRemainingMs(timer: PrepTimer, now: number, minutes: number): number {
  return remainingMs(timer.startedAt, timer.pausedAt ?? now, minutes);
}

/** Départ équivalent à cet instant (pause en cours déduite) : ce qu'on envoie à la génération. */
export function effectiveStart(timer: PrepTimer, now: number): number {
  return timer.pausedAt === null ? timer.startedAt : timer.startedAt + Math.max(0, now - timer.pausedAt);
}

// ---------------------------------------------------------------------------
// localStorage (navigation privée, quota : tout est protégé, jamais d'exception)
// ---------------------------------------------------------------------------

const CHANGE_EVENT = "grand-oral-studio:prep-change";

export function readPrepRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readPrepTimer(key: string, now: number): PrepTimer | null {
  return parsePrepTimer(readPrepRaw(key), now);
}

export function writePrepTimer(key: string, timer: PrepTimer | null): void {
  try {
    if (timer) window.localStorage.setItem(key, serializePrepTimer(timer));
    else window.localStorage.removeItem(key);
  } catch {
    // Stockage indisponible : le chrono ne survivra pas au rechargement.
  }
  // L'évènement « storage » ne prévient que les AUTRES onglets : celui-ci est prévenu à part.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
}

/** Démarre le chrono s'il n'en existe aucun de valide ; renvoie l'état en vigueur. */
export function startPrepTimerIfIdle(key: string, now: number): PrepTimer {
  const current = readPrepTimer(key, now);
  if (current) return current;
  const started: PrepTimer = { startedAt: now, pausedAt: null };
  writePrepTimer(key, started);
  return started;
}

/** Abonnement aux changements du chrono `key` (cet onglet et les autres). */
export function subscribePrepTimer(key: string, onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === key) onChange();
  };
  const onLocal = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === key) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onLocal);
  };
}
