import type { AiSettingsView } from "@/server/repo/types";

/**
 * État de la Configuration IA tel que l'interface l'affiche (DTO construit par
 * la page, partagé avec les composants clients). Ne contient aucune donnée
 * secrète : de la clé, seulement ses 4 derniers caractères et sa date.
 */

export type EngineId = "claude" | "ollama" | "free";

export interface AiSetupStatus {
  /** Choix enregistré ; null = défaut (Claude si une clé existe, sinon Sans IA). */
  selected: EngineId | null;
  /** Qui rédigera réellement au prochain jour J. */
  effective: EngineId | "mock";
  claude: {
    /** Une clé (utilisateur, serveur ou mock) permet d'utiliser Claude. */
    available: boolean;
    source: "user" | "server" | "mock" | "none";
    userKey: { last4: string; addedAtLabel: string } | null;
  };
  /** null : Ollama non configuré sur ce serveur → l'option n'est pas affichée. */
  ollama: { reachable: boolean; models: string[]; selectedModel: string | null } | null;
}


export function toAiSetupStatus(view: AiSettingsView, formatDate: (iso: string) => string): AiSetupStatus {
  const { userKey, engine } = view;
  const ollama = engine.available.ollama;
  return {
    selected: engine.selected,
    effective: engine.effective,
    claude: {
      available: engine.available.claude,
      source: view.effectiveSource,
      userKey:
        userKey.configured && userKey.last4 !== null
          ? { last4: userKey.last4, addedAtLabel: userKey.updatedAt ? formatDate(userKey.updatedAt) : "" }
          : null,
    },
    ollama: ollama.configured ? { reachable: ollama.reachable, models: ollama.models, selectedModel: ollama.selectedModel } : null,
  };
}
