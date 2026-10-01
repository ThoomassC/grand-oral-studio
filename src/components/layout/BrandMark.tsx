/** Pictogramme de l'app : une diapositive et un pupitre stylisés. Décoratif. */
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <rect x="2.5" y="3.5" width="19" height="12" rx="2" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d="M6.5 8h7M6.5 11h4.5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 15.5v5M8.5 20.5h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
