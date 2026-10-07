"use server";

import { z } from "zod";
import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import { BrandSchema, PromptTemplateSchema } from "@/domain/schemas";
import * as repo from "../repo/programs";
import { ValidationError } from "../errors";
import { IdSchema, parseInput, ProgramMetaSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

// Les paramètres sont typés pour l'appelant mais revalidés : un client peut tout envoyer.
type ProgramMetaInput = z.input<typeof ProgramMetaSchema>;
type BrandInput = z.input<typeof BrandSchema>;
type TemplateInput = z.input<typeof PromptTemplateSchema>;

/**
 * Jeton de concurrence optimiste : date d'enregistrement (ISO) reçue au chargement,
 * null = jamais enregistré, absent = pas de contrôle (appelants antérieurs, import appliqué).
 */
const SavedAtTokenSchema = z.iso.datetime({ offset: true }).nullable().optional();

function parseSavedAtToken(value: unknown): string | null | undefined {
  const parsed = SavedAtTokenSchema.safeParse(value);
  // Jeton forgé ou abîmé : on n'écrit pas à l'aveugle.
  if (!parsed.success) throw new ValidationError("La version de la page est illisible. Rechargez la page.");
  return parsed.data;
}

export async function createProgram(input: ProgramMetaInput): Promise<ActionResult<{ id: string }>> {
  return runAction("createProgram", async ({ user }) => {
    const meta = parseInput(ProgramMetaSchema, input);
    const created = await repo.createProgram(user.id, {
      ...meta,
      brand: defaultBrand(),
      template: defaultTemplate(),
    });
    revalidatePrograms();
    return created;
  });
}

export async function updateProgram(programId: string, input: ProgramMetaInput): Promise<ActionResult<null>> {
  return runAction("updateProgram", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const meta = parseInput(ProgramMetaSchema, input);
    await repo.updateProgramMeta(user.id, id, meta);
    revalidatePrograms(id);
    return null;
  });
}

export async function deleteProgram(programId: string): Promise<ActionResult<null>> {
  return runAction("deleteProgram", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    await repo.deleteProgram(user.id, id);
    revalidatePrograms(id);
    return null;
  });
}

export async function duplicateProgram(programId: string): Promise<ActionResult<{ id: string }>> {
  return runAction("duplicateProgram", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const copy = await repo.duplicateProgram(user.id, id);
    revalidatePrograms();
    return copy;
  });
}

/**
 * Enregistre l'apparence. `expectedSavedAt` : `brandSavedAt` reçu au chargement (ou renvoyé
 * par l'enregistrement précédent) ; périmé → échec CONFLICT qui invite à recharger.
 * Renvoie la nouvelle version, à renvoyer à l'enregistrement suivant.
 */
export async function updateBrand(
  programId: string,
  brand: BrandInput,
  expectedSavedAt?: string | null,
): Promise<ActionResult<{ brandSavedAt: string }>> {
  return runAction("updateBrand", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const value = parseInput(BrandSchema, brand);
    const expected = parseSavedAtToken(expectedSavedAt);
    const saved = await repo.updateBrand(user.id, id, value, expected);
    revalidatePrograms(id);
    return saved;
  });
}

/** Enregistre la trame ; même contrat que updateBrand, avec `templateSavedAt` pour jeton. */
export async function updateTemplate(
  programId: string,
  template: TemplateInput,
  expectedSavedAt?: string | null,
): Promise<ActionResult<{ templateSavedAt: string }>> {
  return runAction("updateTemplate", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const value = parseInput(PromptTemplateSchema, template);
    const expected = parseSavedAtToken(expectedSavedAt);
    const saved = await repo.updateTemplate(user.id, id, value, expected);
    revalidatePrograms(id);
    return saved;
  });
}
