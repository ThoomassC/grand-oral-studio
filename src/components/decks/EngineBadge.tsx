export type DeckEngine = "claude" | "ollama" | "free" | "mock";

const BADGE: Record<DeckEngine, { label: string; className: string }> = {
  // Trame sans IA : surlignée (à compléter), sans ton d'alerte.
  free: { label: "Sans IA · à compléter", className: "hl ring-1 ring-inset ring-on-highlight/25" },
  ollama: { label: "Modèle local", className: "bg-surface-2 text-text ring-1 ring-inset ring-border-strong" },
  claude: { label: "Claude", className: "bg-surface-2 text-text ring-1 ring-inset ring-border-strong" },
  mock: { label: "Démo", className: "bg-surface text-muted ring-1 ring-inset ring-border-strong" },
};

/** Moteur qui a produit un deck ; rien pour les decks antérieurs au suivi (null). */
export function EngineBadge({ engine, className = "" }: { engine: DeckEngine | null; className?: string }) {
  if (!engine) return null;
  const badge = BADGE[engine];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-sm font-semibold ${badge.className} ${className}`}>
      <span className="sr-only">Moteur : </span>
      {badge.label}
    </span>
  );
}

/** Débuts de puce posés par le moteur gratuit sur les contenus à rédiger (decks fr et en). */
const TO_COMPLETE = ["à compléter", "to complete"];

export function isToComplete(text: string): boolean {
  const t = text.trim().toLocaleLowerCase("fr");
  return TO_COMPLETE.some((prefix) => t.startsWith(prefix));
}
