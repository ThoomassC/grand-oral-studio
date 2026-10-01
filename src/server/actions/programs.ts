"use server";

import type { z } from "zod";
import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import { BrandSchema, PromptTemplateSchema } from "@/domain/schemas";
import * as repo from "../repo/programs";
import { IdSchema, parseInput, ProgramMetaSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

// Les paramètres sont typés pour l'appelant mais revalidés : un client peut tout envoyer.
type ProgramMetaInput = z.input<typeof ProgramMetaSchema>;
type BrandInput = z.input<typeof BrandSchema>;
type TemplateInput = z.input<typeof PromptTemplateSchema>;

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

export async function updateBrand(programId: string, brand: BrandInput): Promise<ActionResult<null>> {
  return runAction("updateBrand", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const value = parseInput(BrandSchema, brand);
    await repo.updateBrand(user.id, id, value);
    revalidatePrograms(id);
    return null;
  });
}

export async function updateTemplate(programId: string, template: TemplateInput): Promise<ActionResult<null>> {
  return runAction("updateTemplate", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const value = parseInput(PromptTemplateSchema, template);
    await repo.updateTemplate(user.id, id, value);
    revalidatePrograms(id);
    return null;
  });
}
