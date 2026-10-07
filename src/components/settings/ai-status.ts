import { CLOUD_PROVIDERS, isCloudProvider, isKnownModel, PROVIDER_INFO, type CloudProvider } from "@/domain/ai-providers";
import type { AiSettingsView } from "@/server/repo/types";

/**
 * État de la page Rédaction IA tel que l'interface l'affiche (DTO construit par
 * la page, partagé avec les composants clients). Ne contient aucune donnée
 * secrète : d'une clé, seulement ses 4 derniers caractères et ses dates.
 */

/** Carte « Clé de l'équipe » d'un fournisseur : la clé fournie par le serveur. */
export type TeamChoice = `team-${CloudProvider}`;

/**
 * Un choix de la question 1 : Sans IA, la clé de l'équipe d'un fournisseur, la
 * clé personnelle d'un fournisseur (son id seul), ou le modèle local.
 */
export type WriterChoice = "free" | "ollama" | CloudProvider | TeamChoice;

export function teamChoice(provider: CloudProvider): TeamChoice {
  return `team-${provider}`;
}

/** Fournisseur d'une carte « Clé de l'équipe », null pour les autres choix. */
export function teamProvider(choice: WriterChoice): CloudProvider | null {
  if (!choice.startsWith("team-")) return null;
  const provider = choice.slice("team-".length);
  return isCloudProvider(provider) ? provider : null;
}

/** Valeur d'un radio (ou d'un formulaire) relue en choix connu, sinon null. */
export function parseChoice(raw: unknown): WriterChoice | null {
  if (raw === "free" || raw === "ollama" || isCloudProvider(raw)) return raw;
  if (typeof raw === "string" && raw.startsWith("team-") && isCloudProvider(raw.slice("team-".length))) {
    return raw as TeamChoice;
  }
  return null;
}

export interface ConnectionStatus {
  provider: CloudProvider;
  last4: string;
  /** Modèle de la liste fermée retenu pour cette clé (défaut du fournisseur si aucun n'a été choisi). */
  model: string;
  /** Nom du modèle réellement utilisé (identifiant brut s'il est hors liste, ex. AI_MODEL pour Claude). */
  modelLabel: string;
  /** null : jamais vérifiée depuis la 1.2 (clé reprise de la 1.1). */
  verifiedAtLabel: string | null;
  addedAtLabel: string;
}

export interface AiSetupStatus {
  /** Choix en vigueur : l'enregistré, sinon celui que le serveur applique par défaut. */
  saved: WriterChoice;
  /** Fournisseurs dont le serveur fournit une clé d'équipe (Claude compris en démonstration). */
  team: CloudProvider[];
  /** Clés personnelles enregistrées, dans l'ordre des fournisseurs. */
  connections: ConnectionStatus[];
  /** null : Ollama non configuré sur ce serveur → l'option n'est pas affichée. */
  ollama: { reachable: boolean; models: string[]; selectedModel: string | null } | null;
}

function savedChoice(view: AiSettingsView): WriterChoice {
  const { selection, effective, connections } = view;
  const engine = selection.engine;
  if (engine === "free" || engine === "ollama") return engine;
  if (engine !== null) {
    // keySource NULL (choix de la 1.1) : la clé personnelle d'abord, sinon celle de l'équipe.
    const source = selection.keySource ?? (connections.some((c) => c.provider === engine) ? "user" : "server");
    return source === "server" ? teamChoice(engine) : engine;
  }
  // Aucun choix enregistré : celui que le serveur applique (Claude si une clé existe, sinon Sans IA).
  if (effective.engine === "mock") return teamChoice("claude");
  if (isCloudProvider(effective.engine)) {
    return effective.keySource === "server" ? teamChoice(effective.engine) : effective.engine;
  }
  return effective.engine;
}

function modelLabel(provider: CloudProvider, model: string): string {
  return PROVIDER_INFO[provider].models.find((m) => m.id === model)?.label ?? model;
}

export function toAiSetupStatus(view: AiSettingsView, formatDate: (iso: string) => string): AiSetupStatus {
  const { ollama } = view;
  // En démonstration (AI_PROVIDER=mock), la clé d'équipe Claude est remplacée par le mode démo.
  const team = CLOUD_PROVIDERS.filter((p) => view.team.includes(p) || (p === "claude" && view.mock));
  const connections = CLOUD_PROVIDERS.flatMap((provider) => {
    const c = view.connections.find((conn) => conn.provider === provider);
    if (!c) return [];
    return [
      {
        provider,
        last4: c.last4,
        model: isKnownModel(provider, c.model) ? c.model : PROVIDER_INFO[provider].defaultModel,
        modelLabel: modelLabel(provider, c.model),
        verifiedAtLabel: c.verifiedAt ? formatDate(c.verifiedAt) : null,
        addedAtLabel: formatDate(c.updatedAt),
      },
    ];
  });
  return {
    saved: savedChoice(view),
    team,
    connections,
    ollama: ollama.configured ? { reachable: ollama.reachable, models: ollama.models, selectedModel: ollama.selectedModel } : null,
  };
}
