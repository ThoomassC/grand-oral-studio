import { z } from "zod";
import {
  BrandSchema,
  PromptTemplateSchema,
  stripControlChars,
  type Brand,
  type PromptTemplate,
} from "@/domain/schemas";
import { db } from "../db/client";
import { AppError, DataIntegrityError, LimitExceededError } from "../errors";
import { parseInput, parseStored } from "../validation";
import { denyAccess, programAccess } from "./access";
import { brandJson, readBrand, readTemplate, templateJson } from "./mappers";
import { updateBrand, updateTemplate } from "./programs";

/**
 * Bibliothèque de modèles partagés (v1.2) : apparences et trames publiées depuis un
 * projet, visibles de TOUTE l'instance, appliquées à un autre projet par copie.
 *
 * Droits :
 *  - publier : éditeur au moins du projet source (copie de son apparence ou de sa trame) ;
 *  - lister : tout utilisateur connecté (l'auteur est affiché par son nom, jamais son id
 *    ni son e-mail) ;
 *  - appliquer : éditeur au moins du projet cible (remplace l'apparence ou la trame et
 *    date brandSavedAt / templateSavedAt, comme un enregistrement manuel) ;
 *  - retirer : l'auteur seul (un modèle est public : 403 et non 404 pour un autre).
 *
 * Invariants garantis par la base : kind connu, nom 1..120, payload objet JSON
 * (CHECK SharedModel_*), auteur existant (FK cascade). Garantis par le code : payload
 * conforme à BrandSchema / PromptTemplateSchema (validé à l'écriture et à la lecture),
 * plafond par auteur et déduplication d'un double envoi (sous verrou consultatif).
 */

export const SHARED_MODEL_KINDS = ["brand", "template"] as const;
export const SharedModelKindSchema = z.enum(SHARED_MODEL_KINDS, "Type de modèle attendu : apparence ou trame.");
export type SharedModelKind = z.output<typeof SharedModelKindSchema>;

export const SharedModelNameSchema = z
  .string("Donnez un nom au modèle.")
  .overwrite(stripControlChars)
  .trim()
  .min(1, "Donnez un nom au modèle.")
  .max(120, "Le nom du modèle ne doit pas dépasser 120 caractères.");

/** Publication d'un modèle (action) : type et nom, validés au bord. */
export const PublishModelInputSchema = z.object({ kind: SharedModelKindSchema, name: SharedModelNameSchema });

/** Modèles publiés par auteur au plus (la bibliothèque est commune à toute l'instance). */
export const MAX_MODELS_PER_AUTHOR = 50;
/** Une publication identique (auteur, type, nom) dans cet intervalle est un double envoi. */
const PUBLISH_DEDUPE_SECONDS = 60;
/** Modèles listés au plus (les plus récents d'abord). */
const LIST_LIMIT = 200;

const STORED_KIND: Record<SharedModelKind, "BRAND" | "TEMPLATE"> = { brand: "BRAND", template: "TEMPLATE" };
const APP_KIND: Record<string, SharedModelKind> = { BRAND: "brand", TEMPLATE: "template" };

class SharedModelNotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
  constructor() {
    super("Ce modèle est introuvable : il a peut-être été retiré de la bibliothèque.");
  }
}

class SharedModelForbiddenError extends AppError {
  readonly code = "FORBIDDEN" as const;
  readonly status = 403;
  constructor() {
    super("Seul l'auteur d'un modèle peut le retirer de la bibliothèque.");
  }
}

export type SharedModelPreview =
  | { kind: "brand"; colors: Brand["colors"]; fonts: Brand["fonts"]; hasLogo: boolean }
  | {
      kind: "template";
      format: PromptTemplate["format"];
      language: PromptTemplate["language"];
      durationMinutes: number;
      sections: { title: string; slides: number }[];
    };

export interface SharedModelSummary {
  id: string;
  kind: SharedModelKind;
  name: string;
  /** Nom affiché de l'auteur. */
  authorName: string;
  /** Vrai si l'appelant en est l'auteur (lui seul peut le retirer). */
  isMine: boolean;
  /** ISO 8601. */
  createdAt: string;
  preview: SharedModelPreview;
}

/**
 * Publie l'apparence ou la trame du projet `programId` (éditeur au moins) sous le nom
 * `name`. Rejouée dans la minute avec les mêmes auteur, type et nom, renvoie le modèle
 * déjà publié (double clic, retry réseau) au lieu d'un doublon.
 */
export async function publishModel(
  userId: string,
  programId: string,
  kind: SharedModelKind,
  name: string,
): Promise<{ id: string; reused: boolean }> {
  const modelName = parseInput(SharedModelNameSchema, name);
  const program = await db().program.findFirst({
    where: { id: programId, ...programAccess(userId, "editor") },
    select: { id: true, brand: true, template: true },
  });
  if (!program) return denyAccess(db(), userId, programId, "editor");
  // Revalidé : on ne publie jamais un JSON qui aurait dérivé du contrat.
  const payload = kind === "brand" ? brandJson(readBrand(program.brand, program.id)) : templateJson(readTemplate(program.template, program.id));
  const storedKind = STORED_KIND[kind];

  return db().$transaction(async (tx) => {
    // Sérialise les publications d'un même auteur : plafond et déduplication exacts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shared-model:${userId}`}))`;
    const recent = await tx.sharedModel.findFirst({
      where: {
        authorId: userId,
        kind: storedKind,
        name: modelName,
        createdAt: { gte: new Date(Date.now() - PUBLISH_DEDUPE_SECONDS * 1000) },
      },
      select: { id: true },
    });
    if (recent) return { id: recent.id, reused: true };
    const count = await tx.sharedModel.count({ where: { authorId: userId } });
    if (count >= MAX_MODELS_PER_AUTHOR) {
      throw new LimitExceededError(
        `Vous avez déjà publié ${MAX_MODELS_PER_AUTHOR} modèles : retirez-en un avant d'en publier un autre.`,
      );
    }
    const created = await tx.sharedModel.create({
      data: { authorId: userId, kind: storedKind, name: modelName, payload },
      select: { id: true },
    });
    return { id: created.id, reused: false };
  });
}

interface ModelListRow {
  id: string;
  kind: string;
  name: string;
  createdAt: Date;
  isMine: boolean;
  authorName: string;
  payload: unknown;
  hasLogo: boolean;
}

function previewOf(row: ModelListRow): SharedModelPreview | null {
  const kind = APP_KIND[row.kind];
  if (kind === "brand") {
    // Le logo n'est pas lu (jusqu'à 700 Ko par modèle) : seule son existence l'est.
    const brand = BrandSchema.safeParse({ ...(row.payload as object), logoDataUrl: null });
    return brand.success ? { kind, colors: brand.data.colors, fonts: brand.data.fonts, hasLogo: row.hasLogo } : null;
  }
  if (kind === "template") {
    const template = PromptTemplateSchema.safeParse(row.payload);
    if (!template.success) return null;
    const t = template.data;
    return {
      kind,
      format: t.format,
      language: t.language,
      durationMinutes: t.durationMinutes,
      sections: t.sections.map((s) => ({ title: s.title, slides: s.slides })),
    };
  }
  return null;
}

/**
 * Modèles de toute l'instance (les plus récents d'abord, 200 au plus), filtrables par
 * type. Le logo des apparences n'est jamais lu (`payload - 'logoDataUrl'`) : la liste
 * reste légère. Un modèle dont le JSON ne respecte plus le contrat est écarté.
 * Parcours de SharedModel sans index de tri : table de bibliothèque, petite par nature
 * (plafond par auteur) ; à revoir avec un index (kind, createdAt DESC) si elle grossit.
 */
export async function listModels(userId: string, kind?: SharedModelKind): Promise<SharedModelSummary[]> {
  const storedKind = kind ? STORED_KIND[kind] : null;
  const rows = await db().$queryRaw<ModelListRow[]>`
    SELECT s."id", s."kind", s."name", s."createdAt",
           (s."authorId" = ${userId}) AS "isMine",
           u."name" AS "authorName",
           (s."payload" - 'logoDataUrl') AS "payload",
           (jsonb_typeof(s."payload" -> 'logoDataUrl') = 'string') AS "hasLogo"
    FROM "SharedModel" s
    JOIN "user" u ON u."id" = s."authorId"
    WHERE (${storedKind}::text IS NULL OR s."kind" = ${storedKind}::text)
    ORDER BY s."createdAt" DESC, s."id" ASC
    LIMIT ${LIST_LIMIT}`;
  return rows.flatMap((row) => {
    const preview = previewOf(row);
    const appKind = APP_KIND[row.kind];
    if (!preview || !appKind) return [];
    return [
      {
        id: row.id,
        kind: appKind,
        name: row.name,
        authorName: row.authorName,
        isMine: row.isMine,
        createdAt: row.createdAt.toISOString(),
        preview,
      },
    ];
  });
}

/** Retire un modèle de la bibliothèque : l'auteur seul (403 pour un autre, 404 s'il n'existe plus). */
export async function deleteModel(userId: string, modelId: string): Promise<void> {
  // Le filtre d'auteur est dans la suppression elle-même : aucune fenêtre entre contrôle et écriture.
  const { count } = await db().sharedModel.deleteMany({ where: { id: modelId, authorId: userId } });
  if (count > 0) return;
  const exists = await db().sharedModel.findUnique({ where: { id: modelId }, select: { id: true } });
  throw exists ? new SharedModelForbiddenError() : new SharedModelNotFoundError();
}

/**
 * Applique un modèle au projet `programId` (éditeur au moins) : remplace son apparence
 * ou sa trame (copie : le modèle peut ensuite être retiré sans effet sur le projet) et
 * date brandSavedAt / templateSavedAt. Projet inaccessible → 404 ; lecteur → 403.
 */
export async function applyModel(userId: string, programId: string, modelId: string): Promise<{ kind: SharedModelKind }> {
  const model = await db().sharedModel.findUnique({
    where: { id: modelId },
    select: { id: true, kind: true, payload: true },
  });
  const kind = model ? APP_KIND[model.kind] : undefined;
  if (!model || !kind) {
    // L'existence du projet n'est pas révélée par un modèle absent : l'accès est vérifié d'abord.
    const visible = await db().program.findFirst({ where: { id: programId, ...programAccess(userId, "editor") }, select: { id: true } });
    if (!visible) return denyAccess(db(), userId, programId, "editor");
    throw new SharedModelNotFoundError();
  }
  if (kind === "brand") {
    await updateBrand(userId, programId, parseStored(BrandSchema, model.payload, "SharedModel.payload", model.id));
  } else {
    await updateTemplate(userId, programId, parseStored(PromptTemplateSchema, model.payload, "SharedModel.payload", model.id));
  }
  return { kind };
}

/** Modèles publiés par `userId` (export du compte), payload complet. */
export async function listAuthoredModels(
  userId: string,
): Promise<{ kind: SharedModelKind; name: string; payload: Brand | PromptTemplate; createdAt: string; updatedAt: string }[]> {
  const rows = await db().sharedModel.findMany({
    where: { authorId: userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_MODELS_PER_AUTHOR * 2,
    select: { id: true, kind: true, name: true, payload: true, createdAt: true, updatedAt: true },
  });
  return rows.map((row) => {
    const kind = APP_KIND[row.kind];
    if (!kind) throw new DataIntegrityError("SharedModel.kind", row.id, row.kind);
    const payload =
      kind === "brand"
        ? parseStored(BrandSchema, row.payload, "SharedModel.payload", row.id)
        : parseStored(PromptTemplateSchema, row.payload, "SharedModel.payload", row.id);
    return { kind, name: row.name, payload, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  });
}
