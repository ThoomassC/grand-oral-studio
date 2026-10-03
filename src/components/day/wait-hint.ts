/** Moteur effectif d'une génération (cf. AiSettingsView["engine"]["effective"]). */
export type GenerationEngine = "claude" | "ollama" | "free" | "mock";

/**
 * Attente annoncée pendant la génération du deck final, selon le moteur. Un
 * modèle local est bien plus lent qu'une API (3 min 09 observées avec
 * qwen2.5:14b sur 31 diapos ; le délai maximal est de 10 min).
 */
export function generationWaitHint(engine: GenerationEngine): string {
  switch (engine) {
    case "claude":
      return "Cela prend en général 1 à 3 minutes.";
    case "ollama":
      return "Avec un modèle local, comptez plusieurs minutes : souvent 3 à 5, jusqu'à 10 minutes pour un long deck ou une machine modeste.";
    case "free":
    case "mock":
      return "Cela prend quelques secondes.";
  }
}
