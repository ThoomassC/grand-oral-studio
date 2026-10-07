"use server";

import * as repo from "../repo/shared-models";
import { IdSchema, parseInput } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

/**
 * Bibliothèque de modèles partagés (apparences et trames). Les droits sont vérifiés
 * dans le dépôt, sur la ressource : éditeur du projet source pour publier, éditeur
 * du projet cible pour appliquer, auteur seul pour retirer.
 */

/** Publie l'apparence (`kind: "brand"`) ou la trame (`"template"`) du projet sous `name`. */
export async function publishModel(
  programId: string,
  input: { kind: repo.SharedModelKind; name: string },
): Promise<ActionResult<{ id: string; reused: boolean }>> {
  return runAction("publishModel", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const { kind, name } = parseInput(repo.PublishModelInputSchema, input);
    return repo.publishModel(user.id, id, kind, name);
  });
}

/** Modèles de l'instance, éventuellement d'un seul type. */
export async function listSharedModels(kind?: repo.SharedModelKind): Promise<ActionResult<repo.SharedModelSummary[]>> {
  return runAction("listSharedModels", async ({ user }) => {
    const filter = kind === undefined ? undefined : parseInput(repo.SharedModelKindSchema, kind);
    return repo.listModels(user.id, filter);
  });
}

/** Remplace l'apparence ou la trame du projet par celle du modèle. */
export async function applyModel(programId: string, modelId: string): Promise<ActionResult<{ kind: repo.SharedModelKind }>> {
  return runAction("applyModel", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const model = parseInput(IdSchema, modelId);
    const applied = await repo.applyModel(user.id, id, model);
    revalidatePrograms(id);
    return applied;
  });
}

/** Retire un modèle de la bibliothèque (auteur seul). */
export async function deleteModel(modelId: string): Promise<ActionResult<null>> {
  return runAction("deleteModel", async ({ user }) => {
    await repo.deleteModel(user.id, parseInput(IdSchema, modelId));
    return null;
  });
}
