"use server";

import type { z } from "zod";
import { ThemeInputSchema } from "@/domain/schemas";
import { ValidationError } from "../errors";
import * as repo from "../repo/themes";
import type { ThemeView } from "../repo/types";
import { parseThemeImport } from "../theme-import";
import { IdSchema, parseInput, ThemeIdListSchema, ThemeImportTextSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

type ThemeFormInput = z.input<typeof ThemeInputSchema>;

export async function addTheme(programId: string, input: ThemeFormInput): Promise<ActionResult<ThemeView>> {
  return runAction("addTheme", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const theme = parseInput(ThemeInputSchema, input);
    const created = await repo.addTheme(user.id, id, theme);
    revalidatePrograms(id);
    return created;
  });
}

export async function updateTheme(themeId: string, input: ThemeFormInput): Promise<ActionResult<ThemeView>> {
  return runAction("updateTheme", async ({ user }) => {
    const id = parseInput(IdSchema, themeId);
    const theme = parseInput(ThemeInputSchema, input);
    const updated = await repo.updateTheme(user.id, id, theme);
    revalidatePrograms(updated.programId);
    return updated;
  });
}

export async function deleteTheme(themeId: string): Promise<ActionResult<null>> {
  return runAction("deleteTheme", async ({ user }) => {
    const id = parseInput(IdSchema, themeId);
    const { programId } = await repo.deleteTheme(user.id, id);
    revalidatePrograms(programId);
    return null;
  });
}

export async function reorderThemes(programId: string, themeIds: string[]): Promise<ActionResult<null>> {
  return runAction("reorderThemes", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const ids = parseInput(ThemeIdListSchema, themeIds);
    await repo.reorderThemes(user.id, id, ids);
    revalidatePrograms(id);
    return null;
  });
}

/**
 * Import texte : une ligne = `Nom | description | mot1, mot2` (max 30 lignes,
 * 20 Ko). Tout ou rien : la moindre ligne invalide rejette l'import, avec le
 * détail par ligne dans `fieldErrors.text`. Les thèmes déjà présents (même nom)
 * sont ignorés, ce qui rend l'import rejouable.
 */
export async function importThemes(
  programId: string,
  text: string,
): Promise<ActionResult<{ created: number; skipped: string[] }>> {
  return runAction("importThemes", async ({ user }) => {
    const id = parseInput(IdSchema, programId);
    const raw = parseInput(ThemeImportTextSchema, text);
    const parsed = parseThemeImport(raw);
    if (!parsed.ok) {
      throw new ValidationError("L'import contient des erreurs.", {
        text: parsed.errors.map((e) => (e.line > 0 ? `Ligne ${e.line} : ${e.message}` : e.message)),
      });
    }
    const result = await repo.importThemes(user.id, id, parsed.themes);
    revalidatePrograms(id);
    return result;
  });
}
