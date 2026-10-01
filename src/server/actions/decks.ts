"use server";

import type { z } from "zod";
import { SlideSchema, type DeckSpec } from "@/domain/schemas";
import * as repo from "../repo/decks";
import { IdSchema, parseInput, SlideIndexSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

type SlideInput = z.input<typeof SlideSchema>;

/** Remplace la diapo `index` ; renvoie le deck à jour. */
export async function updateDeckSlide(
  deckId: string,
  index: number,
  slide: SlideInput,
): Promise<ActionResult<{ spec: DeckSpec }>> {
  return runAction("updateDeckSlide", async ({ user }) => {
    const id = parseInput(IdSchema, deckId);
    const i = parseInput(SlideIndexSchema, index);
    const value = parseInput(SlideSchema, slide);
    const { programId, spec } = await repo.updateDeckSlide(user.id, id, i, value);
    revalidatePrograms(programId);
    return { spec };
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
