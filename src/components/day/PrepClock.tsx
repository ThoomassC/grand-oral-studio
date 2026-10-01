/**
 * Repères visuels du temps de préparation (1 h 30). Purement présentationnels,
 * rendus côté serveur : ils ne décomptent rien, ils rappellent l'enjeu.
 */

export const PREP_MINUTES = 90;

/** « 1 h 30 », « 20 min » : format des durées de l'interface. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m.toString().padStart(2, "0")}`;
}

/** « 1 heure 30 », « 20 minutes » : forme lue par les lecteurs d'écran (« 1 h 30 » est mal prononcé). */
export function spokenDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} minute${m > 1 ? "s" : ""}`;
  const hours = `${h} heure${h > 1 ? "s" : ""}`;
  return m === 0 ? hours : `${hours} ${m.toString().padStart(2, "0")}`;
}

/** Durée : forme visuelle compacte masquée, forme lisible pour les technologies d'assistance. */
export function Duration({ minutes, className = "" }: { minutes: number; className?: string }) {
  return (
    <>
      <span aria-hidden="true" className={className}>
        {formatDuration(minutes)}
      </span>
      <span className="sr-only">{spokenDuration(minutes)}</span>
    </>
  );
}

/**
 * Cadran de chronomètre : graduations tous les quarts d'heure sur 1 h 30, et
 * le secteur surligné des premières minutes (`usedMinutes`). Décoratif : le
 * texte équivalent est toujours donné à côté.
 */
export function PrepDial({ usedMinutes = 3, className = "h-28 w-28" }: { usedMinutes?: number; className?: string }) {
  const r = 40;
  const angle = (Math.min(usedMinutes, PREP_MINUTES) / PREP_MINUTES) * 2 * Math.PI;
  const end = { x: 50 + r * Math.sin(angle), y: 50 - r * Math.cos(angle) };
  const ticks = Array.from({ length: 18 }, (_, i) => i);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" className={className}>
      <circle cx="50" cy="50" r="47" fill="var(--surface)" stroke="currentColor" strokeWidth="2.5" />
      {angle > 0 ? (
        <path d={`M50 50 L50 ${50 - r} A${r} ${r} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`} fill="var(--highlight)" />
      ) : null}
      {ticks.map((i) => {
        const a = (i / ticks.length) * 2 * Math.PI;
        const major = i % 3 === 0;
        const r1 = major ? 36 : 39.5;
        return (
          <line
            key={i}
            x1={50 + r1 * Math.sin(a)}
            y1={50 - r1 * Math.cos(a)}
            x2={50 + 43 * Math.sin(a)}
            y2={50 - 43 * Math.cos(a)}
            stroke="currentColor"
            strokeWidth={major ? 2.5 : 1.2}
            strokeLinecap="round"
            opacity={major ? 1 : 0.55}
          />
        );
      })}
      <line x1="50" y1="50" x2={end.x} y2={end.y} stroke={angle > 0 ? "var(--on-highlight)" : "currentColor"} strokeWidth="2.5" strokeLinecap="round" />
      <rect x="44" y="0" width="12" height="5" rx="1.5" fill="currentColor" />
      <circle cx="50" cy="50" r="3.2" fill="currentColor" />
    </svg>
  );
}

/** Pastille sobre « Préparation 1 h 30 » avec une petite icône de chronomètre. */
export function PrepTimeBadge({ minutes = PREP_MINUTES }: { minutes?: number }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1 text-sm">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="13.5" r="7.5" />
        <path d="M12 13.5V9.5M10 2.5h4M18.5 6l1.5-1.5" />
      </svg>
      <span className="text-muted">Préparation</span>
      <strong className="font-bold">
        <Duration minutes={minutes} className="num" />
      </strong>
    </p>
  );
}
