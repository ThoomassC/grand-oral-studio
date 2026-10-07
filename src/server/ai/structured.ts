import { z } from "zod";
import { AiInvalidOutputError } from "../errors";

/**
 * Interprétation d'une sortie JSON structurée, commune aux fournisseurs :
 * JSON.parse → schéma PERMISSIF (forme seule). La normalisation dans les bornes
 * du domaine puis la validation stricte suivent chez l'appelant (`strict`).
 */

export interface ParseOptions {
  /**
   * Les champs `null` valent « absent » : le mode json_schema strict des API
   * OpenAI-compatibles impose chaque propriété et rend les optionnelles nulles.
   */
  nullsAsMissing?: boolean;
}

/** Retire récursivement les propriétés nulles des objets (les null des tableaux restent : le schéma les refusera). */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, dropNulls(v)]),
    );
  }
  return value;
}

export function parseJson(operation: string, text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new AiInvalidOutputError(`${operation}: réponse sans texte`);
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new AiInvalidOutputError(`${operation}: JSON invalide`, { cause: error });
  }
}

export function checkShape<S extends z.ZodType>(operation: string, json: unknown, schema: S, options: ParseOptions = {}): z.output<S> {
  const parsed = schema.safeParse(options.nullsAsMissing ? dropNulls(json) : json);
  if (!parsed.success) {
    throw new AiInvalidOutputError(`${operation}: forme JSON inattendue`, { cause: parsed.error });
  }
  return parsed.data;
}

export function parseStructured<S extends z.ZodType>(operation: string, text: string, schema: S, options: ParseOptions = {}): z.output<S> {
  return checkShape(operation, parseJson(operation, text), schema, options);
}

export function strict<S extends z.ZodType>(operation: string, schema: S, value: unknown): z.output<S> {
  const checked = schema.safeParse(value);
  if (!checked.success) {
    throw new AiInvalidOutputError(`${operation}: sortie hors schéma après normalisation`, { cause: checked.error });
  }
  return checked.data;
}
