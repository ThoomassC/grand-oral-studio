import type { EngineId } from "@/domain/ai-providers";

/** Moteur effectif d'une génération (cf. WriterView["engine"]). */
export type GenerationEngine = EngineId | "mock";

/**
 * Attente annoncée pendant la génération du deck final, selon le moteur. Un
 * modèle local est bien plus lent qu'une API (3 min 09 observées avec
 * qwen2.5:14b sur 31 diapos ; le délai maximal est de 10 min). Un deck IA hors
 * des seuils de qualité fait l'objet d'une seconde tentative : l'attente double
 * (pour un fournisseur en ligne, dans la limite de l'échéance d'environ 5 min).
 */
export function generationWaitHint(engine: GenerationEngine): string {
  switch (engine) {
    case "ollama":
      return "Avec un modèle local, comptez plusieurs minutes : souvent 3 à 5, jusqu'à 10 minutes pour un long diaporama ou une machine modeste, et le double si une seconde tentative est nécessaire.";
    case "free":
    case "mock":
      return "Cela prend quelques secondes.";
    default:
      return "Cela prend en général 1 à 3 minutes, le double si une seconde tentative est nécessaire.";
  }
}
