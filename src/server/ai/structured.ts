import { z } from "zod";
import { AiInvalidOutputError } from "../errors";

/**
 * Interprétation d'une sortie JSON structurée, commune aux fournisseurs :
 * JSON.parse → schéma PERMISSIF (forme seule). La normalisation dans les bornes
 * du domaine puis la validation stricte suivent chez l'appelant (`strict`).
 */

export function parseStructured<S extends z.ZodType>(operation: string, text: string, schema: S): z.output<S> {
  const trimmed = text.trim();
  if (!trimmed) throw new AiInvalidOutputError(`${operation}: réponse sans texte`);
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (error) {
    throw new AiInvalidOutputError(`${operation}: JSON invalide`, { cause: error });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AiInvalidOutputError(`${operation}: forme JSON inattendue`, { cause: parsed.error });
  }
  return parsed.data;
}

export function strict<S extends z.ZodType>(operation: string, schema: S, value: unknown): z.output<S> {
  const checked = schema.safeParse(value);
  if (!checked.success) {
    throw new AiInvalidOutputError(`${operation}: sortie hors schéma après normalisation`, { cause: checked.error });
  }
  return checked.data;
}
