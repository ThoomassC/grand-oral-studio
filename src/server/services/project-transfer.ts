import { z } from "zod";
import { exampleProject } from "@/domain/examples";
import {
  assembleProjectExport,
  exportByteLength,
  parseProjectExport,
  PROJECT_EXPORT_TOO_LARGE_MESSAGE,
  PROJECT_FILE_MAX_BYTES,
  PROJECT_FILE_TOO_LARGE_MESSAGE,
  serializeProjectExport,
  type ExportFileProject,
  type ProjectExport,
} from "@/domain/project-export";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { AppError, NotFoundError, ValidationError } from "../errors";
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

/**
 * Export trop lourd pour être servi (coupure des hébergeurs à 4,5 Mo) ou réimporté
 * (4 Mo) : erreur attendue, 413, avec ce que l'utilisateur peut faire.
 */
export class ExportTooLargeError extends AppError {
  readonly code = "LIMIT_EXCEEDED" as const;
  readonly status = 413;
}

/**
 * Taille maximale de l'export du compte : sous la coupure des réponses des hébergeurs
 * (Vercel : 4,5 Mo), faute de quoi le téléchargement échouerait sans explication.
 */
export const ACCOUNT_EXPORT_MAX_BYTES = 4_500_000;
export const ACCOUNT_EXPORT_TOO_LARGE_MESSAGE =
  "Vos données dépassent 4,5 Mo une fois exportées, même sans les logos : le fichier ne peut pas être téléchargé d'un bloc. Exportez vos projets un par un depuis leur menu « Exporter le projet ».";

/**
 * Fichier d'export d'un projet que `userId` peut lire : contenu, texte du fichier
 * (JSON compact) et titre à lui donner. Donnée abîmée en base → export dégradé
 * (journalisé), jamais une panne. Plus lourd que l'import n'accepte (4 Mo) →
 * ExportTooLargeError (413) : un fichier qu'on ne pourrait pas réimporter n'est pas livré.
 */
export async function exportProject(
  userId: string,
  programId: string,
  deps: TransferDeps,
): Promise<{ data: ProjectExport; body: string; title: string }> {
  await consumeQuota(projectExportQuotaKey(userId), 1, PROJECT_EXPORT_QUOTA, "import");
  const source = await readProjectForExport(userId, programId);
  const { data, issues } = assembleProjectExport(source, clock(deps));
  if (issues.length > 0) deps.log.warn("project.export_degraded", { programId, issues });
  const body = serializeProjectExport(data);
  const bytes = exportByteLength(body);
  if (bytes > PROJECT_FILE_MAX_BYTES) {
    deps.log.info("project.export_too_large", { programId, bytes });
    throw new ExportTooLargeError(PROJECT_EXPORT_TOO_LARGE_MESSAGE);
  }
  deps.log.info("project.exported", {
    programId,
    themes: data.project.themes.length,
    decks: data.project.decks.length,
    skipped: data.project.skipped,
    bytes,
  });
  return { data, body, title: data.project.name };
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

/** Mention posée sur un projet ou un modèle dont le logo a été retiré de l'export du compte. */
export const LOGO_NOT_INCLUDED = "logo non inclus";

/** Projet de l'export du compte : format d'export de projet, logo retiré (mention `note`). */
export type AccountExportProject = ExportFileProject & { note?: typeof LOGO_NOT_INCLUDED };

export type AccountExportModel = {
  kind: SharedModelKind;
  name: string;
  payload: Brand | PromptTemplate;
  createdAt: string;
  updatedAt: string;
  note?: typeof LOGO_NOT_INCLUDED;
};

/**
 * Export du compte (portabilité RGPD) : profil, réglages IA SANS aucune clé (ni
 * chiffrée, ni ses 4 derniers caractères), projets POSSÉDÉS au format d'export de
 * projet, modèles publiés. Jamais : hash de mot de passe, jeton, session,
 * identifiant interne, projets partagés par d'autres (ils appartiennent à leur
 * propriétaire), membres. Logos retirés (« logo non inclus ») : jusqu'à 500 Ko
 * chacun, ils feraient dépasser la taille téléchargeable ; l'export d'un projet
 * les contient.
 */
export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  version: typeof ACCOUNT_EXPORT_VERSION;
  exportedAt: string;
  profile: AccountRecord["profile"];
  aiSettings: AccountRecord["aiSettings"];
  aiConnections: AccountRecord["aiConnections"];
  projects: AccountExportProject[];
  /** Vrai si le compte possède plus de projets que l'export n'en contient. */
  projectsTruncated: boolean;
  /** Projets illisibles même en mode dégradé, laissés hors de l'export (0 d'ordinaire). */
  projectsSkipped: number;
  sharedModels: AccountExportModel[];
}

/** Retire le logo d'une apparence ; `removed` dit s'il y en avait un. */
function withoutLogo<T extends object>(payload: T): { payload: T; removed: boolean } {
  if (!("logoDataUrl" in payload) || payload.logoDataUrl === null || payload.logoDataUrl === undefined) {
    return { payload, removed: false };
  }
  return { payload: { ...payload, logoDataUrl: null }, removed: true };
}

/**
 * Export du compte : contenu et texte du fichier (JSON compact). Un projet abîmé
 * ne fait jamais échouer l'export (dégradé, ou écarté et compté si même cela
 * échoue). Plus lourd que ACCOUNT_EXPORT_MAX_BYTES → ExportTooLargeError (413).
 */
export async function exportAccount(userId: string, deps: TransferDeps): Promise<{ data: AccountExport; body: string }> {
  await consumeQuota(accountExportQuotaKey(userId), 1, ACCOUNT_EXPORT_QUOTA, "import");
  const record = await readAccountRecord(userId);
  // Compte supprimé entre la session et la lecture.
  if (!record) throw new NotFoundError();
  const { projects: rows, truncated } = await readOwnedProjectsForExport(userId);
  const models = await listAuthoredModels(userId);
  const now = clock(deps);

  const projects: AccountExportProject[] = [];
  let projectsSkipped = 0;
  for (const { programId, source } of rows) {
    try {
      const { data, issues } = assembleProjectExport(source, now);
      if (issues.length > 0) deps.log.warn("project.export_degraded", { programId, issues });
      const { payload: brand, removed } = withoutLogo(data.project.brand);
      // Même format que l'export d'un projet : chaque entrée se réimporte telle quelle.
      projects.push({ ...data.project, brand, ...(removed ? { note: LOGO_NOT_INCLUDED } : {}) });
    } catch (error) {
      projectsSkipped += 1;
      deps.log.error("account.export_project_skipped", { programId, error });
    }
  }
  const sharedModels: AccountExportModel[] = models.map((model) => {
    const { payload, removed } = withoutLogo(model.payload);
    return { ...model, payload, ...(removed ? { note: LOGO_NOT_INCLUDED } : {}) };
  });

  const data: AccountExport = {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    profile: record.profile,
    aiSettings: record.aiSettings,
    aiConnections: record.aiConnections,
    projects,
    projectsTruncated: truncated,
    projectsSkipped,
    sharedModels,
  };
  const body = JSON.stringify(data);
  const bytes = exportByteLength(body);
  if (bytes > ACCOUNT_EXPORT_MAX_BYTES) {
    deps.log.info("account.export_too_large", { projects: projects.length, bytes });
    throw new ExportTooLargeError(ACCOUNT_EXPORT_TOO_LARGE_MESSAGE);
  }
  deps.log.info("account.exported", { projects: projects.length, truncated, skipped: projectsSkipped, models: sharedModels.length, bytes });
  return { data, body };
}
