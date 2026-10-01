"use client";

import { useEffect, useState } from "react";

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}

/**
 * Temps écoulé depuis `since` (horodatage ms), rafraîchi chaque seconde.
 * Volontairement hors région live : on n'annonce pas chaque seconde.
 */
export function ElapsedTime({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  // Synchronisation avec une horloge externe (timer), nettoyée au démontage.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{format(now - since)}</span>;
}
