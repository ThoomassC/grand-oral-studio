import { Badge, type BadgeTone } from "@thomascaron/opale-ui";

export type DeckEngine = "claude" | "ollama" | "free" | "mock";

const BADGE: Record<DeckEngine, { label: string; tone: BadgeTone }> = {
  // Trame sans IA : l'accent d'Opale (à compléter), sans ton d'alerte.
  free: { label: "Sans IA · à compléter", tone: "accent" },
  ollama: { label: "Modèle local", tone: "info" },
  claude: { label: "Claude", tone: "primary" },
  mock: { label: "Démo", tone: "neutral" },
};

/** Moteur qui a produit un deck (`Badge` d'Opale) ; rien pour les decks antérieurs au suivi (null). */
export function EngineBadge({ engine, className }: { engine: DeckEngine | null; className?: string }) {
  if (!engine) return null;
  const badge = BADGE[engine];
  return (
    <Badge tone={badge.tone} className={className}>
      <span className="sr-only">Moteur : </span>
      {badge.label}
    </Badge>
  );
}

/** Débuts de puce posés par le moteur gratuit sur les contenus à rédiger (decks fr et en). */
const TO_COMPLETE = ["à compléter", "to complete"];

export function isToComplete(text: string): boolean {
  const t = text.trim().toLocaleLowerCase("fr");
  return TO_COMPLETE.some((prefix) => t.startsWith(prefix));
}
