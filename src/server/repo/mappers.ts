import { ENGINE_IDS } from "@/domain/ai-providers";
import { BrandSchema, DeckSpecSchema, PromptTemplateSchema, type Brand, type PromptTemplate } from "@/domain/schemas";
import type { Prisma } from "../db/generated/prisma/client";
import type { DeckKind } from "../db/generated/prisma/enums";
import { assertWritable, parseStored } from "../validation";
import { z } from "zod";
import type { DeckEngine, DeckView, ThemeView } from "./types";

/** Lignes brutes → vues typées, avec validation zod des colonnes JSON. */

interface DeckRow {
  id: string;
  programId: string;
  themeId: string | null;
  kind: DeckKind;
  problem: string | null;
  engine: string | null;
  practice: boolean;
  spec: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

const DeckEngineSchema = z.enum([...ENGINE_IDS, "mock"]).nullable() satisfies z.ZodType<DeckEngine | null>;

export function toDeckView(row: DeckRow): DeckView {
  return {
    id: row.id,
    programId: row.programId,
    themeId: row.themeId,
    kind: row.kind,
    problem: row.problem,
    engine: parseStored(DeckEngineSchema, row.engine, "Deck.engine", row.id),
    practice: row.practice,
    spec: parseStored(DeckSpecSchema, row.spec, "Deck.spec", row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface ThemeRow {
  id: string;
  programId: string;
  position: number;
  name: string;
  description: string;
  keywords: string[];
  notes: string;
  problems: string[];
  updatedAt: Date;
}

export function toThemeView(row: ThemeRow): ThemeView {
  return {
    id: row.id,
    programId: row.programId,
    position: row.position,
    name: row.name,
    description: row.description,
    keywords: row.keywords,
    notes: row.notes,
    problems: row.problems,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function readBrand(value: Prisma.JsonValue, programId: string): Brand {
  return parseStored(BrandSchema, value, "Program.brand", programId);
}

export function readTemplate(value: Prisma.JsonValue, programId: string): PromptTemplate {
  return parseStored(PromptTemplateSchema, value, "Program.template", programId);
}

/**
 * Sérialise une valeur validée en JSON Prisma. La re-validation garantit qu'on
 * n'écrit jamais en base un JSON hors contrat, quelle que soit sa provenance.
 */
export function brandJson(value: unknown): Prisma.InputJsonObject {
  return assertWritable(BrandSchema, value, "Program.brand");
}
export function templateJson(value: unknown): Prisma.InputJsonObject {
  return assertWritable(PromptTemplateSchema, value, "Program.template");
}
export function specJson(value: unknown): Prisma.InputJsonObject {
  return assertWritable(DeckSpecSchema, value, "Deck.spec");
}
