/**
 * Barre de progression / confiance avec sa valeur en texte : l'information
 * n'est jamais portée par la seule longueur ou couleur de la barre.
 */
export function Meter({
  value,
  max = 1,
  label,
  valueText,
  className = "",
}: {
  value: number;
  max?: number;
  label: string;
  valueText: string;
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={className}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        className="h-2 w-full overflow-hidden rounded-xs bg-surface-2 ring-1 ring-inset ring-border"
      >
        <div className="h-full rounded-xs bg-accent" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
