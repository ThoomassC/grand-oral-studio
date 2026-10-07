import { z } from "zod";
import { exampleProject } from "@/domain/examples";
import {
  buildProjectExport,
  parseProjectExport,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FILE_TOO_LARGE_MESSAGE,
  type ExportedProject,
  type ProjectExport,
} from "@/domain/project-export";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { NotFoundError, ValidationError } from "../errors";
import type { Logger } from "../logger";
import { consumeImportQuota, consumeQuota, type QuotaPolicy } from "../rate-limit";
import {
  insertProject,
  readAccountRecord,
  readOwnedProjectsForExport,
  readProjectForExport,
  type AccountRecord,
} from "../repo/project-transfer";
import { listAuthoredModels, type SharedModelKind } from "../repo/shared-models";

/**
 * Export/import de projet, projet d'exemple et export du compte — logique métier
 * sans Next ni HTTP (appelée par les actions de ./actions/transfer.ts et les routes
 * /api/projets/[id]/export et /api/compte/export).
 *
 * Ordre immuable : quota (anti-abus, avant tout calcul) → lecture du fichier
 * (taille et format, sans base) → accès aux données (rôle vérifié dans la requête).
 * Aucun appel externe, aucun effet de bord hors base.
 */

export interface TransferDeps {
  log: Logger;
  /** Horloge injectable (tests). */
  now?: () => Date;
}

/** Exports de projet (JSON) par utilisateur et par heure. */
export const PROJECT_EXPORT_QUOTA: QuotaPolicy = { limit: 120, windowSeconds: 3600 };
/** Exports du compte par utilisateur et par heure (lecture de tous ses projets). */
export const ACCOUNT_EXPORT_QUOTA: QuotaPolicy = { limit: 5, windowSeconds: 3600 };
/** Fenêtre de déduplication d'un import ou d'une création d'exemple rejoués. */
const IMPORT_DEDUPE_SECONDS = 60;

export function projectExportQuotaKey(userId: string): string {
  return `export:${userId}`;
}
export function accountExportQuotaKey(userId: string): string {
  return `account-export:${userId}`;
}

/**
 * Fichier de projet reçu du client (FormData, champ `file`) : taille contrôlée AVANT
 * toute lecture du contenu. Le corps d'une Server Action est déjà plafonné à 5 Mo
 * (next.config.ts).
 */
export const ProjectFileSchema = z.object({
  file: z
    .instanceof(File, { message: "Choisissez un fichier d'export de projet (.json)." })
    .refine((f) => f.size > 0, { message: "Le fichier est vide." })
    .refine((f) => f.size <= PROJECT_FILE_MAX_BYTES, { message: PROJECT_FILE_TOO_LARGE_MESSAGE })
    .refine((f) => f.name.length > 0 && f.name.length <= 255, { message: "Nom de fichier invalide." }),
});

const clock = (deps: TransferDeps) => (deps.now ?? (() => new Date()))();

/** Fichier d'export d'un projet que `userId` peut lire, et le titre à donner au fichier. */
export async function exportProject(
  userId: string,
  programId: string,
  deps: TransferDeps,
): Promise<{ data: ProjectExport; title: string }> {
  await consumeQuota(projectExportQuotaKey(userId), 1, PROJECT_EXPORT_QUOTA, "import");
  const project = await readProjectForExport(userId, programId);
  const data = buildProjectExport(project, clock(deps));
  deps.log.info("project.exported", {
    programId,
    themes: data.project.themes.length,
    decks: data.project.decks.length,
  });
  return { data, title: data.project.name };
}

export interface ImportedProject {
  id: string;
  /** Vrai si le même import, rejoué aussitôt, a renvoyé le projet déjà créé. */
  reused: boolean;
}

/**
 * Crée un NOUVEAU projet appartenant à `userId` à partir du texte d'un fichier
 * d'export. Fichier illisible, étranger, d'une autre version ou invalide →
 * ValidationError (422) avec les champs en cause ; rien n'est créé.
 */
export async function importProject(userId: string, raw: string, deps: TransferDeps): Promise<ImportedProject> {
  await consumeImportQuota(userId);
  const parsed = parseProjectExport(raw);
  if (!parsed.ok) {
    deps.log.info("project.import_rejected", { reason: parsed.message });
    throw new ValidationError(parsed.message, parsed.fieldErrors);
  }
  const result = await insertProject(userId, parsed.project, {
    dedupeSeconds: IMPORT_DEDUPE_SECONDS,
    markSaved: true,
    now: clock(deps),
  });
  deps.log.info("project.imported", {
    programId: result.id,
    reused: result.reused,
    themes: parsed.project.themes.length,
    decks: parsed.project.decks.length,
  });
  return result;
}

/**
 * Crée le projet d'exemple pour `userId` (apparence et trame par défaut, non marquées
 * comme enregistrées : le parcours invite à les ajuster). Rejouée dans la minute,
 * renvoie le projet déjà créé.
 */
export async function createExampleProject(userId: string, deps: TransferDeps): Promise<ImportedProject> {
  await consumeImportQuota(userId);
  const result = await insertProject(userId, exampleProject(), {
    dedupeSeconds: IMPORT_DEDUPE_SECONDS,
    markSaved: false,
    now: clock(deps),
  });
  deps.log.info("project.example_created", { programId: result.id, reused: result.reused });
  return result;
}

export const ACCOUNT_EXPORT_FORMAT = "grand-oral-studio/compte";
export const ACCOUNT_EXPORT_VERSION = 1;

/**
 * Export du compte (portabilité RGPD) : profil, réglages IA SANS aucune clé (ni
 * chiffrée, ni ses 4 derniers caractères), projets POSSÉDÉS au format d'export de
 * projet, modèles publiés. Jamais : hash de mot de passe, jeton, session,
 * identifiant interne, projets partagés par d'autres (ils appartiennent à leur
 * propriétaire), membres.
 */
export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  version: typeof ACCOUNT_EXPORT_VERSION;
  exportedAt: string;
  profile: AccountRecord["profile"];
  aiSettings: AccountRecord["aiSettings"];
  aiConnections: AccountRecord["aiConnections"];
  projects: ExportedProject[];
  /** Vrai si le compte possède plus de projets que l'export n'en contient. */
  projectsTruncated: boolean;
  sharedModels: { kind: SharedModelKind; name: string; payload: Brand | PromptTemplate; createdAt: string; updatedAt: string }[];
}

export async function exportAccount(userId: string, deps: TransferDeps): Promise<AccountExport> {
  await consumeQuota(accountExportQuotaKey(userId), 1, ACCOUNT_EXPORT_QUOTA, "import");
  const record = await readAccountRecord(userId);
  // Compte supprimé entre la session et la lecture.
  if (!record) throw new NotFoundError();
  const { projects, truncated } = await readOwnedProjectsForExport(userId);
  const sharedModels = await listAuthoredModels(userId);
  const now = clock(deps);
  const result: AccountExport = {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    profile: record.profile,
    aiSettings: record.aiSettings,
    aiConnections: record.aiConnections,
    // Même format que l'export d'un projet : chaque entrée se réimporte telle quelle.
    projects: projects.map((p) => buildProjectExport(p, now).project),
    projectsTruncated: truncated,
    sharedModels,
  };
  deps.log.info("account.exported", { projects: result.projects.length, truncated, models: sharedModels.length });
  return result;
}
