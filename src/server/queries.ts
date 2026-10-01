import { getDeck as repoGetDeck, listFinalDecks as repoListFinalDecks } from "./repo/decks";
import { getProgram as repoGetProgram, listPrograms as repoListPrograms } from "./repo/programs";
import type { AiSettingsView, DeckWithProgram, FinalDeckSummary, ProgramDetail, ProgramSummary } from "./repo/types";
import { listOllamaModels } from "./ai/ollama";
import { createLogger } from "./logger";
import { getAiSettingsView } from "./services/ai-settings";

/**
 * Lectures pour les Server Components. `userId` est explicite (obtenu par
 * requireUser() dans la page) ; une ressource absente ou étrangère lève
 * NotFoundError — à traduire en notFound() côté page.
 */

export type { DeckWithProgram, FinalDeckSummary, ProgramDetail, ProgramSummary } from "./repo/types";
export type { AiSettingsView, DeckView, ThemeView, ThemeWithSkeleton } from "./repo/types";
export { NotFoundError } from "./errors";

export function listPrograms(userId: string): Promise<ProgramSummary[]> {
  return repoListPrograms(userId);
}

/** Programme + thèmes ordonnés + squelette de chaque thème. */
export function getProgram(userId: string, id: string): Promise<ProgramDetail> {
  return repoGetProgram(userId, id);
}

/** Deck + charte et gabarit de son programme (pour l'aperçu et l'export). */
export function getDeck(userId: string, id: string): Promise<DeckWithProgram> {
  return repoGetDeck(userId, id);
}

export function listFinalDecks(userId: string, programId: string): Promise<FinalDeckSummary[]> {
  return repoListFinalDecks(userId, programId);
}

/** Réglages IA de l'utilisateur (page Paramètres). Ne contient jamais la clé. */
export function getAiSettings(userId: string): Promise<AiSettingsView> {
  return getAiSettingsView(userId, {
    env: process.env,
    log: createLogger({ query: "getAiSettings" }),
    listOllamaModels: (baseUrl) => listOllamaModels(baseUrl),
  });
}
