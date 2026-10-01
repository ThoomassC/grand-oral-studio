import type { PromptPair, ThemeRef } from "@/domain/contracts";
import type { Classification, DeckSpec, PromptTemplate } from "@/domain/schemas";

/**
 * Indications structurées passées en plus du prompt. Le fournisseur réel les
 * ignore (tout est dans le prompt) ; le mock s'en sert pour produire une sortie
 * déterministe cohérente avec le gabarit et les thèmes, sans analyser le texte.
 */
export interface DeckHints {
  template: PromptTemplate;
  theme: ThemeRef;
  programName: string;
  /** Problématique du jour J (deck final). */
  problem?: string;
  /** Squelette existant à enrichir (deck final). */
  skeleton?: DeckSpec | null;
}

export interface ClassifyHints {
  themes: ThemeRef[];
  problem: string;
  hintedThemeId?: string | null;
}

export interface AiProvider {
  readonly name: string;
  /** Moteur, enregistré sur les decks produits (défaut côté service : "claude"). */
  readonly engine?: "claude" | "ollama" | "mock";
  generateDeck(prompt: PromptPair, hints?: DeckHints): Promise<DeckSpec>;
  classify(prompt: PromptPair, hints?: ClassifyHints): Promise<Classification>;
}
