"use server";

import * as service from "../services/project-transfer";
import { parseInput } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

/**
 * Import d'un projet depuis un fichier d'export (.json) et création du projet
 * d'exemple. Les deux créent un NOUVEAU projet appartenant à l'utilisateur et sont
 * rejouables sans doublon dans la minute (même résultat, `reused: true`).
 * L'export (projet, compte) passe par les routes GET /api/projets/[id]/export et
 * /api/compte/export (téléchargement).
 */

/** Fichier d'export de projet sous le champ `file` (4 Mo au plus). */
export async function importProject(formData: FormData): Promise<ActionResult<service.ImportedProject>> {
  return runAction("importProject", async (ctx) => {
    const raw = formData instanceof FormData ? formData.get("file") : null;
    const { file } = parseInput(service.ProjectFileSchema, { file: raw });
    const text = await file.text();
    const created = await service.importProject(ctx.user.id, text, { log: ctx.log });
    revalidatePrograms();
    return created;
  });
}

/** Crée le projet d'exemple « Grand oral MAALSI (exemple) ». */
export async function createExampleProject(): Promise<ActionResult<service.ImportedProject>> {
  return runAction("createExampleProject", async (ctx) => {
    const created = await service.createExampleProject(ctx.user.id, { log: ctx.log });
    revalidatePrograms();
    return created;
  });
}
