"use server";

import { z } from "zod";
import { SlideSchema, type DeckSpec } from "@/domain/schemas";
import { getEngineForUser } from "../ai";
import { EngineUnavailableError } from "../errors";
import * as repo from "../repo/decks";
import * as editing from "../services/deck-editing";
import { IdSchema, parseInput, SlideIndexSchema } from "../validation";
import type { ActionResult } from "./result";
import { revalidatePrograms } from "./revalidate";
import { runAction } from "./run";

type SlideInput = z.input<typeof SlideSchema>;

const VersionSchema = z.iso.datetime({ offset: true, message: "Version du diaporama invalide : rechargez la page." });
const DirectionSchema = z.enum(["up", "down"], { message: "Sens de déplacement inconnu." });

/** Deck à jour et sa nouvelle version, après une modification. */
export interface DeckEdit {
  spec: DeckSpec;
  updatedAt: string;
}

/** Message de la régénération pour un utilisateur Sans IA (le bouton est masqué, l'appel direct reste refusé). */
const AI_ONLY_MESSAGE =
  "Disponible avec une rédaction IA : choisissez un rédacteur IA dans la Rédaction IA pour réécrire une diapo.";

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
): Promise<ActionResult<DeckEdit>> {
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

/**
 * Réécrit la diapo `index` par l'IA du rédacteur de l'utilisateur (quota IA,
 * contrôle de version avant l'appel et à l'écriture). Sans IA : refus explicite,
 * jamais de bascule. `code` exposé : CONFLICT invite à recharger.
 */
export async function regenerateSlide(
  deckId: string,
  index: number,
  expectedUpdatedAt: string,
): Promise<ActionResult<DeckEdit>> {
  return runAction(
    "regenerateSlide",
    async ({ user, log }) => {
      const id = parseInput(IdSchema, deckId);
      const i = parseInput(SlideIndexSchema, index);
      const version = parseInput(VersionSchema, expectedUpdatedAt);
      const resolved = await getEngineForUser(user.id, { log });
      if (resolved.engine === "free") throw new EngineUnavailableError(AI_ONLY_MESSAGE);
      const { programId, spec, updatedAt } = await editing.regenerateSlide(user.id, id, i, version, {
        ai: resolved.provider,
        billing: resolved.billing,
        log,
      });
      revalidatePrograms(programId);
      return { spec, updatedAt };
    },
    { exposeCode: true },
  );
}

/** Insère une diapo vierge (section voisine) juste après la diapo `index`. */
export async function insertSlideAfter(deckId: string, index: number, expectedUpdatedAt: string): Promise<ActionResult<DeckEdit>> {
  return runAction(
    "insertSlideAfter",
    async ({ user }) => {
      const id = parseInput(IdSchema, deckId);
      const i = parseInput(SlideIndexSchema, index);
      const version = parseInput(VersionSchema, expectedUpdatedAt);
      const { programId, spec, updatedAt } = await repo.insertSlide(user.id, id, i + 1, null, version);
      revalidatePrograms(programId);
      return { spec, updatedAt };
    },
    { exposeCode: true },
  );
}

/** Supprime la diapo `index` (pas la couverture ; au moins 2 diapos restent). */
export async function removeSlide(deckId: string, index: number, expectedUpdatedAt: string): Promise<ActionResult<DeckEdit>> {
  return runAction(
    "removeSlide",
    async ({ user }) => {
      const id = parseInput(IdSchema, deckId);
      const i = parseInput(SlideIndexSchema, index);
      const version = parseInput(VersionSchema, expectedUpdatedAt);
      const { programId, spec, updatedAt } = await repo.removeSlide(user.id, id, i, version);
      revalidatePrograms(programId);
      return { spec, updatedAt };
    },
    { exposeCode: true },
  );
}

/** Monte (`up`) ou descend (`down`) la diapo `index` d'un cran ; la couverture reste en tête. */
export async function moveSlide(
  deckId: string,
  index: number,
  direction: "up" | "down",
  expectedUpdatedAt: string,
): Promise<ActionResult<DeckEdit>> {
  return runAction(
    "moveSlide",
    async ({ user }) => {
      const id = parseInput(IdSchema, deckId);
      const i = parseInput(SlideIndexSchema, index);
      const dir = parseInput(DirectionSchema, direction);
      const version = parseInput(VersionSchema, expectedUpdatedAt);
      const { programId, spec, updatedAt } = await repo.moveSlide(user.id, id, i, dir === "up" ? i - 1 : i + 1, version);
      revalidatePrograms(programId);
      return { spec, updatedAt };
    },
    { exposeCode: true },
  );
}

/** Copie du diaporama dans le même projet (éditeur) ; renvoie l'identifiant de la copie. */
export async function duplicateDeck(deckId: string): Promise<ActionResult<{ deckId: string }>> {
  return runAction("duplicateDeck", async ({ user }) => {
    const id = parseInput(IdSchema, deckId);
    const copy = await repo.duplicateDeck(user.id, id);
    revalidatePrograms(copy.programId);
    return { deckId: copy.deckId };
  });
}

/**
 * Supprime un deck. `undoUntil` (ISO) : échéance de l'annulation (corbeille) ;
 * null pour un ancien squelette, supprimé définitivement.
 */
export async function deleteDeck(deckId: string): Promise<ActionResult<{ undoUntil: string | null }>> {
  return runAction("deleteDeck", async ({ user }) => {
    const id = parseInput(IdSchema, deckId);
    const { programId, undoUntil } = await repo.deleteDeck(user.id, id);
    revalidatePrograms(programId);
    return { undoUntil: undoUntil ?? null };
  });
}

/** Annule la suppression d'un deck (éditeur), dans le délai de la corbeille. */
export async function restoreDeck(deckId: string): Promise<ActionResult<null>> {
  return runAction("restoreDeck", async ({ user }) => {
    const id = parseInput(IdSchema, deckId);
    const { programId } = await repo.restoreDeck(user.id, id);
    revalidatePrograms(programId);
    return null;
  });
}
