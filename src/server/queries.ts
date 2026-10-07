import { getDeck as repoGetDeck, listFinalDecks as repoListFinalDecks } from "./repo/decks";
import { getProgram as repoGetProgram, listPrograms as repoListPrograms } from "./repo/programs";
import {
  countSharedOwnedPrograms as repoCountSharedOwnedPrograms,
  listMembers as repoListMembers,
  type ProgramMembers,
} from "./repo/members";
import { getProfile as repoGetProfile } from "./repo/profile";
import { getExamReadiness as repoGetExamReadiness, type ExamReadinessCounts } from "./repo/readiness";
import type {
  AiSettingsView,
  DeckWithProgram,
  FinalDeckSummary,
  ProfileView,
  ProgramDetail,
  ProgramSummary,
  WriterView,
} from "./repo/types";
import { listOllamaModels } from "./ai/ollama";
import { createLogger } from "./logger";
import { getAiSettingsView, getWriterView } from "./services/ai-settings";

/**
 * Lectures pour les Server Components. `userId` est explicite (obtenu par
 * requireUser() dans la page). Toutes demandent le rôle de LECTEUR sur le
 * projet (propriétaire, éditeur ou lecteur) et ignorent la corbeille ; une
 * ressource absente, étrangère ou à la corbeille lève NotFoundError — à
 * traduire en notFound() côté page.
 */

export type { DeckWithProgram, FinalDeckSummary, ProgramDetail, ProgramSummary } from "./repo/types";
export type {
  AiConnectionView,
  AiSettingsView,
  AiWriterState,
  DeckView,
  ProfileView,
  ProgramRole,
  SignInMethod,
  ThemeView,
  ThemeWithSkeleton,
  WriterView,
} from "./repo/types";
export type { ExamReadinessCounts } from "./repo/readiness";
export type { MemberView, ProgramMembers } from "./repo/members";
export { ForbiddenError, NotFoundError } from "./errors";

/** Profil de l'utilisateur connecté (page /profil) ; null si le compte n'existe plus. */
export function getProfile(userId: string): Promise<ProfileView | null> {
  return repoGetProfile(userId);
}

export function listPrograms(userId: string): Promise<ProgramSummary[]> {
  return repoListPrograms(userId);
}

/** Programme + thèmes ordonnés + squelette de chaque thème. */
export function getProgram(userId: string, id: string): Promise<ProgramDetail> {
  return repoGetProgram(userId, id);
}

/** Deck + charte et gabarit de son programme (pour l'aperçu et l'export, ouverts au lecteur). */
export function getDeck(userId: string, id: string): Promise<DeckWithProgram> {
  return repoGetDeck(userId, id);
}

export function listFinalDecks(userId: string, programId: string): Promise<FinalDeckSummary[]> {
  return repoListFinalDecks(userId, programId);
}

/** Liste « Avant l'examen » du Jour J : entraînements, répétitions de l'utilisateur, export tenté. */
export function getExamReadiness(userId: string, programId: string): Promise<ExamReadinessCounts> {
  return repoGetExamReadiness(userId, programId);
}

/** Propriétaire et membres d'un projet (page Partage), pour tout membre. */
export function listMembers(userId: string, programId: string): Promise<ProgramMembers> {
  return repoListMembers(userId, programId);
}

/** Projets actifs de l'utilisateur partagés avec au moins un membre (avertissement avant la suppression du compte). */
export function countSharedOwnedPrograms(userId: string): Promise<number> {
  return repoCountSharedOwnedPrograms(userId);
}

/** Réglages IA de l'utilisateur (page Rédaction IA). Ne contient jamais la clé. */
export function getAiSettings(userId: string): Promise<AiSettingsView> {
  return getAiSettingsView(userId, {
    env: process.env,
    log: createLogger({ query: "getAiSettings" }),
    listOllamaModels: (baseUrl) => listOllamaModels(baseUrl),
  });
}

/**
 * Rédacteur actuel de l'utilisateur, pour les bandeaux (« Rédaction : X ») : une
 * lecture en base, sans sonde Ollama ni déchiffrement. Ne contient jamais de clé.
 */
export function getWriter(userId: string): Promise<WriterView> {
  return getWriterView(userId, { env: process.env });
}
