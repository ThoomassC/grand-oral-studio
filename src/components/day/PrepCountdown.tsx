"use client";

import { Button } from "@thomascaron/opale-ui";
import { useCallback, useSyncExternalStore } from "react";
import { milestones } from "@/domain/prep-clock";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Duration, PrepDial } from "./PrepClock";
import {
  parsePrepTimer,
  pauseTimer,
  readPrepRaw,
  readPrepTimer,
  resumeTimer,
  subscribePrepTimer,
  timerRemainingMs,
  writePrepTimer,
} from "./prep-timer";

const SECOND = 1000;
const MINUTE = 60_000;

/** Horloge partagée, rafraîchie chaque seconde (arrondie à la seconde SUPÉRIEURE : jamais avant un départ enregistré). */
function subscribeClock(onTick: () => void): () => void {
  const timer = window.setInterval(onTick, SECOND);
  return () => window.clearInterval(timer);
}
const clockSnapshot = () => Math.ceil(Date.now() / SECOND) * SECOND;
const serverClock = () => 0;

/**
 * Décompte réel du temps de préparation (îlot client de l'en-tête du Jour J).
 * Avant le départ, il affiche la durée de la trame, comme le repère d'avant ;
 * il démarre quand la problématique est saisie ou collée pour la première fois
 * (DayJourney écrit le départ dans localStorage), survit au rechargement, et
 * propose Pause / Reprendre / Réinitialiser. Le rendu serveur et l'hydratation
 * montrent l'état « pas encore démarré » ; l'état enregistré arrive ensuite.
 */
export function PrepCountdown({ storageKey, minutes }: { storageKey: string; minutes: number }) {
  const subscribe = useCallback((onChange: () => void) => subscribePrepTimer(storageKey, onChange), [storageKey]);
  const raw = useSyncExternalStore(subscribe, () => readPrepRaw(storageKey), () => null);
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, serverClock);
  const timer = raw === null ? null : parsePrepTimer(raw, now);

  const total = minutes * MINUTE;
  const remaining = timer ? timerRemainingMs(timer, now, minutes) : total;
  const over = timer !== null && remaining === 0;
  const paused = timer !== null && timer.pausedAt !== null;
  const current = milestones(remaining, minutes);
  const milestone = timer && !over ? current.items.find((m) => m.id === current.current)?.label : null;

  function update(next: (t: NonNullable<typeof timer>, at: number) => NonNullable<typeof timer>) {
    const at = Date.now();
    const fresh = readPrepTimer(storageKey, at);
    if (fresh) writePrepTimer(storageKey, next(fresh, at));
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <p className="flex items-center gap-3 rounded-lg border border-border bg-surface py-2 pr-4 pl-2 shadow-card">
        <PrepDial usedMinutes={timer ? (total - remaining) / MINUTE : 0} totalMinutes={minutes} className="h-10 w-10 shrink-0" />
        <span className="leading-tight">
          <span className="block text-lg font-bold">
            <Duration minutes={Math.ceil(remaining / MINUTE)} className="num" />
          </span>
          <span className="text-sm text-muted">
            {timer === null ? "de préparation" : over ? "temps écoulé" : paused ? "en pause" : "restantes"}
          </span>
        </span>
      </p>
      {timer ? (
        <div className="flex flex-wrap gap-2">
          {over ? null : paused ? (
            <Button type="button" variant="ghost" size="small" onClick={() => update(resumeTimer)}>
              Reprendre
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="small" onClick={() => update(pauseTimer)}>
              Pause
            </Button>
          )}
          <Button type="button" variant="ghost" size="small" onClick={() => writePrepTimer(storageKey, null)}>
            Réinitialiser
          </Button>
        </div>
      ) : null}
      <LiveRegion className="text-sm text-muted">{milestone}</LiveRegion>
    </div>
  );
}
