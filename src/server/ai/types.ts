import type { CloudProvider } from "@/domain/ai-providers";
import type { PromptPair, ThemeRef } from "@/domain/contracts";
import type { JuryQuestions } from "@/domain/jury-questions";
import type { Classification, DeckSpec, PromptTemplate, Slide } from "@/domain/schemas";

/**
 * Indications structurées passées en plus du prompt. Le fournisseur réel les
 * ignore (tout est dans le prompt) ; le mock s'en sert pour produire une sortie
 * déterministe cohérente avec la trame et le sujet, sans analyser le texte.
 */
export interface DeckHints {
  template: PromptTemplate;
  /** Sujet retenu ; null = sans sujet (problématique et trame seules). */
  subject: ThemeRef | null;
  programName: string;
  /** Problématique du jour J. */
  problem: string;
  /**
   * Même prompt, notes du sujet bornées à `subjectNotesMax` caractères (0 = sans
   * notes) : ce qui est sacrifié en premier quand un modèle à contexte borné
   * (Ollama) ne peut pas tout recevoir.
   */
  compactPrompt?: (subjectNotesMax: number) => PromptPair;
}

export interface ClassifyHints {
  themes: ThemeRef[];
  problem: string;
  hintedThemeId?: string | null;
}

/** Réglages d'un appel. */
export interface CallOptions {
  /**
   * Budget de temps de l'appel, en ms (AbortSignal) ; défaut propre au
   * fournisseur et à l'opération. Ignoré par Ollama (pas d'échéance) et le mock.
   */
  budgetMs?: number;
}

/** Indications du mock pour les questions du jury : le diaporama et son sujet. */
export interface JuryQuestionsHints {
  spec: DeckSpec;
  subject: ThemeRef | null;
}

/** Indications du mock pour la réécriture d'une diapo : la diapo actuelle. */
export interface SlideHints {
  current: Slide;
}

/** Tâches structurées autres que le deck complet et la reconnaissance du sujet. */
export type StructuredRequest =
  | { task: "juryQuestions"; prompt: PromptPair; hints?: JuryQuestionsHints }
  | { task: "slide"; prompt: PromptPair; hints?: SlideHints };

export type StructuredTask = StructuredRequest["task"];

/** Résultat VALIDÉ (schéma strict du domaine) de chaque tâche. */
export interface StructuredResults {
  juryQuestions: JuryQuestions;
  slide: Slide;
}

export type StructuredResult<R extends StructuredRequest> = StructuredResults[R["task"]];

/** Moteur enregistré sur les decks produits. */
export type ProviderEngine = CloudProvider | "ollama" | "mock";

/**
 * Fournisseur IA : rédaction du deck du jour J, reconnaissance du sujet et
 * tâches structurées ponctuelles (questions du jury, une diapo). Imports sans IA.
 */
export interface AiProvider {
  readonly name: string;
  /** Moteur, enregistré sur les decks produits (défaut côté service : "claude"). */
  readonly engine?: ProviderEngine;
  generateDeck(prompt: PromptPair, hints?: DeckHints, options?: CallOptions): Promise<DeckSpec>;
  classify(prompt: PromptPair, hints?: ClassifyHints, options?: CallOptions): Promise<Classification>;
  generateStructured<R extends StructuredRequest>(req: R, options?: CallOptions): Promise<StructuredResult<R>>;
}
