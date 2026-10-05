import type { PromptPair, ThemeRef } from "@/domain/contracts";
import type { Classification, DeckSpec, PromptTemplate } from "@/domain/schemas";

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

/** Fournisseur IA : rédaction du deck du jour J et reconnaissance du sujet, rien d'autre (imports sans IA). */
export interface AiProvider {
  readonly name: string;
  /** Moteur, enregistré sur les decks produits (défaut côté service : "claude"). */
  readonly engine?: "claude" | "ollama" | "mock";
  generateDeck(prompt: PromptPair, hints?: DeckHints): Promise<DeckSpec>;
  classify(prompt: PromptPair, hints?: ClassifyHints): Promise<Classification>;
}
