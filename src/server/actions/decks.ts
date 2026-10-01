"use server";

import { z } from "zod";
import { SlideSchema, type DeckSpec } from "@/domain/schemas";
import * as repo from "../repo/decks";
import { IdSchema, parseInput, SlideIndexSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

type SlideInput = z.input<typeof SlideSchema>;

const VersionSchema = z.iso.datetime({ offset: true, message: "Version du diaporama invalide : rechargez la page." });

/**
 * Remplace la diapo `index`. `expectedUpdatedAt` est la version (ISO) sur
 * laquelle l'édition est basée ; si le deck a changé depuis, refus explicite.
 * Renvoie le deck à jour et sa nouvelle version.
 */
export async function updateDeckSlide(
  deckId: string,
  index: number,
  slide: SlideInput,
  expectedUpdatedAt: string,
): Promise<ActionResult<{ spec: DeckSpec; updatedAt: string }>> {
  return runAction("updateDeckSlide", async ({ user }) => {
    const id = parseInput(IdSchema, deckId);
    const i = parseInput(SlideIndexSchema, index);
    const value = parseInput(SlideSchema, slide);
    const version = parseInput(VersionSchema, expectedUpdatedAt);
    const { programId, spec, updatedAt } = await repo.updateDeckSlide(user.id, id, i, value, version);
    revalidatePrograms(programId);
    return { spec, updatedAt };
  });
}

export async function deleteDeck(deckId: string): Promise<ActionResult<null>> {
  return runAction("deleteDeck", async ({ user }) => {
    const id = parseInput(IdSchema, deckId);
    const { programId } = await repo.deleteDeck(user.id, id);
    revalidatePrograms(programId);
    return null;
  });
}
