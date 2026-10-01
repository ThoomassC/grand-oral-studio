import type { ThemeRef } from "@/domain/contracts";
import type { Brand, DeckSpec, PromptTemplate } from "@/domain/schemas";
import type { DeckKind } from "../db/generated/prisma/enums";

/**
 * Vues renvoyées par la couche d'accès aux données. Les champs JSON sont
 * toujours typés par les schémas zod du domaine (validés à la lecture).
 */

export type { DeckKind };

export interface ProgramSummary {
  id: string;
  name: string;
  description: string;
  themeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeckView {
  id: string;
  programId: string;
  themeId: string;
  kind: DeckKind;
  problem: string | null;
  spec: DeckSpec;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeView extends ThemeRef {
  programId: string;
  position: number;
}

export interface ThemeWithSkeleton extends ThemeView {
  skeleton: DeckView | null;
}

export interface ProgramDetail {
  id: string;
  name: string;
  description: string;
  brand: Brand;
  template: PromptTemplate;
  createdAt: Date;
  updatedAt: Date;
  themes: ThemeWithSkeleton[];
}

/** Deck accompagné de ce qu'il faut pour l'exporter (charte et gabarit du programme). */
export interface DeckWithProgram extends DeckView {
  themeName: string;
  program: { id: string; name: string; brand: Brand; template: PromptTemplate };
}

export interface FinalDeckSummary {
  id: string;
  themeId: string;
  themeName: string;
  problem: string;
  title: string;
  createdAt: Date;
}
