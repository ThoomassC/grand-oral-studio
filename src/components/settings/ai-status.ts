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

/** « Claude », « Sans IA », « Ollama · mistral », « Démo (contenus factices) ». */
export function writerLabel(status: AiSetupStatus): string {
  switch (status.effective) {
    case "claude":
      return "Claude";
    case "free":
      return "Sans IA";
    case "mock":
      return "Démo (contenus factices)";
    case "ollama": {
      const model = status.ollama?.selectedModel;
      return model ? `Ollama · ${model}` : "Ollama";
    }
  }
}

/** Prêt si : Sans IA ; démo ; Claude avec une clé ; Ollama joignable avec le modèle choisi installé. */
export function isReady(status: AiSetupStatus): boolean {
  switch (status.effective) {
    case "free":
    case "mock":
      return true;
    case "claude":
      return status.claude.available;
    case "ollama": {
      const ollama = status.ollama;
      return ollama !== null && ollama.reachable && ollama.selectedModel !== null && ollama.models.includes(ollama.selectedModel);
    }
  }
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
