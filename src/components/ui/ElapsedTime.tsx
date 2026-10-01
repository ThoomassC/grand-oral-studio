"use client";

import { useEffect, useState } from "react";

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}

/**
 * Millisecondes écoulées depuis `since` (horodatage), rafraîchies chaque
 * seconde ; 0 si `since` est null. Synchronisation avec une horloge
 * extérieure (timer), nettoyée au démontage ou au changement de `since`.
 */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [since]);
  return since === null || now < since ? 0 : now - since;
}

/**
 * Temps écoulé lisible. Volontairement hors de toute région live : on
 * n'annonce pas chaque seconde, mais le texte reste lisible au lecteur d'écran.
 */
export function ElapsedTime({ since }: { since: number }) {
  const elapsed = useElapsed(since);
  return <span className="tabular-nums">{formatElapsed(elapsed)}</span>;
}
