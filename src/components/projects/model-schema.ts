import { z } from "zod";
import { stripControlChars } from "@/domain/schemas";

/**
 * Miroir client de `SharedModelNameSchema` (src/server/repo/shared-models.ts) :
 * mêmes bornes, mêmes messages. Le module serveur n'est pas importable ici ;
 * l'action `publishModel` revalide de toute façon.
 */
export const MODEL_NAME_MAX = 120;

export const ModelNameSchema = z
  .string("Donnez un nom au modèle.")
  .overwrite(stripControlChars)
  .trim()
  .min(1, "Donnez un nom au modèle.")
  .max(MODEL_NAME_MAX, `Le nom du modèle ne doit pas dépasser ${MODEL_NAME_MAX} caractères.`);
