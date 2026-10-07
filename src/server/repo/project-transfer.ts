import { z } from "zod";
import {
  EXPORT_DECK_ENGINES,
  PROJECT_EXPORT_MAX_DECKS,
  type ExportedProject,
  type ExportedProjectSchema,
} from "@/domain/project-export";
import { DeckSpecSchema } from "@/domain/schemas";
import { db } from "../db/client";
import type { Prisma } from "../db/generated/prisma/client";
import { parseStored } from "../validation";
import { denyAccess, liveDeck, programAccess } from "./access";
import { brandJson, readBrand, readTemplate, specJson, templateJson } from "./mappers";

/**
 * Accès aux données de l'export/import de projet et de l'export du compte. Chaque
 * fonction prend `userId` explicitement et filtre l'accès dans la requête même.
 * Aucune dépendance à Next/HTTP. Le format du fichier vit dans le domaine
 * (src/domain/project-export.ts) ; ici, seulement des lignes → contenu exportable.
 *
 * Jamais lus : identifiants exposés, propriétaire, membres, clés, jetons. Les
 * sélections de colonnes sont explicites, ce qui n'est pas lu ne peut pas fuiter.
 */

type ExportedProjectInput = z.input<typeof ExportedProjectSchema>;

const ExportDeckEngineSchema = z.enum(EXPORT_DECK_ENGINES).nullable();

/** Colonnes lues pour un projet exporté : contenu seulement. */
const exportSelect = {
  id: true,
  name: true,
  description: true,
  brand: true,
  template: true,
  themes: {
    orderBy: { position: "asc" },
    select: { name: true, description: true, keywords: true, notes: true, problems: true },
  },
  decks: {
    // Decks finaux actifs ; ni squelettes (v1.0) ni corbeille. Les plus récents si le plafond est atteint.
    where: { kind: "FINAL", ...liveDeck },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PROJECT_EXPORT_MAX_DECKS,
    select: {
      id: true,
      practice: true,
      problem: true,
      spec: true,
      engine: true,
      createdAt: true,
      theme: { select: { name: true } },
    },
  },
} as const satisfies Prisma.ProgramSelect;

type ExportRow = Prisma.ProgramGetPayload<{ select: typeof exportSelect }>;

function toExportedProject(row: ExportRow): ExportedProjectInput {
  return {
    name: row.name,
    description: row.description,
    brand: readBrand(row.brand, row.id),
    template: readTemplate(row.template, row.id),
    themes: row.themes.map((t) => ({
      name: t.name,
      description: t.description,
      keywords: t.keywords,
      notes: t.notes,
      problems: t.problems,
    })),
    // Ordre chronologique dans le fichier.
    decks: [...row.decks].reverse().map((d) => ({
      themeName: d.theme?.name ?? null,
      practice: d.practice,
      // CHECK Deck_problem_matches_kind : un FINAL a toujours une problématique.
      problem: d.problem ?? "",
      spec: parseStored(DeckSpecSchema, d.spec, "Deck.spec", d.id),
      engine: parseStored(ExportDeckEngineSchema, d.engine, "Deck.engine", d.id),
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

/**
 * Contenu exportable d'un projet actif que `userId` peut au moins LIRE (l'export est
 * ouvert au lecteur). Inconnu, étranger ou à la corbeille → NotFoundError.
 */
export async function readProjectForExport(userId: string, programId: string): Promise<ExportedProjectInput> {
  const row = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "viewer") },
    select: exportSelect,
  });
  if (!row) return denyAccess(db(), userId, programId, "viewer");
  return toExportedProject(row);
}

/** Projets exportés au plus dans l'export du compte (comme la liste des projets). */
export const ACCOUNT_EXPORT_PROJECTS_LIMIT = 200;

/** Projets actifs POSSÉDÉS par `userId` (ni partagés, ni à la corbeille), du plus ancien au plus récent. */
export async function readOwnedProjectsForExport(
  userId: string,
): Promise<{ projects: ExportedProjectInput[]; truncated: boolean }> {
  const rows = await db().program.findMany({
    where: { ownerId: userId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: ACCOUNT_EXPORT_PROJECTS_LIMIT + 1,
    select: exportSelect,
  });
  return {
    projects: rows.slice(0, ACCOUNT_EXPORT_PROJECTS_LIMIT).map(toExportedProject),
    truncated: rows.length > ACCOUNT_EXPORT_PROJECTS_LIMIT,
  };
}

export interface InsertProjectOptions {
  /** Un projet de même nom créé par `userId` depuis moins de N s est renvoyé tel quel (rejeu). */
  dedupeSeconds: number;
  /** Apparence et trame considérées comme enregistrées (brandSavedAt / templateSavedAt = maintenant). */
  markSaved: boolean;
  now: Date;
}

/**
 * Crée un NOUVEAU projet appartenant à `userId` à partir d'un contenu déjà validé :
 * sujets aux positions 0..n-1 dans l'ordre du fichier, decks finaux rattachés au
 * PREMIER sujet de même nom (sinon sans sujet), rédigés par l'importateur. Tout ou
 * rien, en une transaction courte (3 à 5 requêtes, aucun appel externe).
 *
 * Idempotence : les imports d'un même utilisateur sont sérialisés (verrou consultatif
 * de transaction) ; un projet de même nom créé dans la fenêtre `dedupeSeconds`
 * et de même contenu (nombres de sujets et de decks) est renvoyé avec `reused: true`
 * (double clic, retry réseau, onglet dupliqué).
 */
export async function insertProject(
  userId: string,
  project: ExportedProject,
  options: InsertProjectOptions,
): Promise<{ id: string; reused: boolean }> {
  // Écritures préparées hors transaction (revalidées : jamais un JSON hors contrat en base).
  const brand = brandJson(project.brand);
  const template = templateJson(project.template);
  const nowMs = options.now.getTime();

  return db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-import:${userId}`}))`;
    const recent = await tx.program.findFirst({
      where: {
        ownerId: userId,
        name: project.name,
        deletedAt: null,
        // Horloge murale (comme createdAt, posé par la base), pas l'horloge injectée.
        createdAt: { gte: new Date(Date.now() - options.dedupeSeconds * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, _count: { select: { themes: true, decks: { where: { kind: "FINAL" } } } } },
    });
    // Même nom, même nombre de sujets et de decks : c'est le même import rejoué.
    if (recent && recent._count.themes === project.themes.length && recent._count.decks === project.decks.length) {
      return { id: recent.id, reused: true };
    }

    const savedAt = options.markSaved ? options.now : null;
    const program = await tx.program.create({
      data: {
        ownerId: userId,
        name: project.name,
        description: project.description,
        brand,
        template,
        brandSavedAt: savedAt,
        templateSavedAt: savedAt,
      },
      select: { id: true },
    });

    const themeIdByName = new Map<string, string>();
    if (project.themes.length > 0) {
      const created = await tx.theme.createManyAndReturn({
        data: project.themes.map((t, position) => ({
          programId: program.id,
          position,
          name: t.name,
          description: t.description,
          keywords: t.keywords,
          notes: t.notes,
          problems: t.problems,
        })),
        select: { id: true, position: true },
      });
      // Correspondance par position (unique par projet), pas par ordre de RETURNING.
      const idByPosition = new Map(created.map((t) => [t.position, t.id]));
      project.themes.forEach((t, position) => {
        const id = idByPosition.get(position);
        if (id && !themeIdByName.has(t.name)) themeIdByName.set(t.name, id);
      });
    }

    if (project.decks.length > 0) {
      await tx.deck.createMany({
        data: project.decks.map((d) => ({
          programId: program.id,
          themeId: d.themeName === null ? null : (themeIdByName.get(d.themeName) ?? null),
          kind: "FINAL" as const,
          problem: d.problem,
          practice: d.practice,
          spec: specJson(d.spec),
          engine: d.engine,
          createdById: userId,
          // Date d'origine conservée (noms de fichiers, ordre), jamais dans le futur.
          createdAt: new Date(Math.min(Date.parse(d.createdAt), nowMs)),
        })),
      });
    }
    return { id: program.id, reused: false };
  });
}

/** Méthodes de connexion (Better Auth) → libellé exporté ; tout autre fournisseur est ignoré. */
const METHOD: Record<string, "password" | "google"> = { credential: "password", google: "google" };

export interface AccountRecord {
  profile: {
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
    signInMethods: ("password" | "google")[];
  };
  aiSettings: { engine: string | null; keySource: string | null; ollamaModel: string | null; updatedAt: string } | null;
  aiConnections: { provider: string; model: string | null; keySaved: true; verifiedAt: string | null; createdAt: string; updatedAt: string }[];
}

/**
 * Profil et réglages IA de `userId`, en sélection de colonnes EXPLICITE : ni hash de
 * mot de passe, ni jeton (session, OAuth), ni clé chiffrée, ni 4 derniers caractères,
 * ni version de clé maître ne sont lus.
 */
export async function readAccountRecord(userId: string): Promise<AccountRecord | null> {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
      accounts: { select: { providerId: true } },
      aiSettings: { select: { engine: true, keySource: true, ollamaModel: true, updatedAt: true } },
      aiCredentials: {
        orderBy: { provider: "asc" },
        select: { provider: true, model: true, verifiedAt: true, createdAt: true, updatedAt: true },
      },
    },
  });
  if (!user) return null;
  const methods = new Set(user.accounts.map((a) => METHOD[a.providerId]).filter((m) => m !== undefined));
  return {
    profile: {
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      signInMethods: (["password", "google"] as const).filter((m) => methods.has(m)),
    },
    aiSettings: user.aiSettings
      ? {
          engine: user.aiSettings.engine,
          keySource: user.aiSettings.keySource,
          ollamaModel: user.aiSettings.ollamaModel,
          updatedAt: user.aiSettings.updatedAt.toISOString(),
        }
      : null,
    aiConnections: user.aiCredentials.map((c) => ({
      provider: c.provider,
      model: c.model,
      keySaved: true as const,
      verifiedAt: c.verifiedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  };
}
