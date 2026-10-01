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
  /** Thèmes disposant d'un squelette. */
  skeletonCount: number;
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
  /** Nombre de decks finaux (jour J) du thème. */
  finalDeckCount: number;
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

/**
 * Deck accompagné de ce qu'il faut pour l'exporter (charte et gabarit du
 * programme). `updatedAt` en ISO : c'est la version à renvoyer à updateDeckSlide.
 */
export interface DeckWithProgram extends Omit<DeckView, "updatedAt"> {
  updatedAt: string;
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
