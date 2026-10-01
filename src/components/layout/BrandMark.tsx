/** Pictogramme de l'app : une diapositive (titre surligné) sur un pupitre. Décoratif. */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <rect x="2.5" y="3.5" width="19" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="5" y="6.4" width="10" height="3.4" rx="0.8" fill="var(--opale-accent)" />
      <path d="M6.5 8.1h7" stroke="var(--opale-on-accent)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.5 12.2h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 15.5v5M8.5 20.5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
