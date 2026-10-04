import type { PromptPair, ThemeRef } from "@/domain/contracts";
import type { RawBrandDraft } from "@/domain/import/brand-from-draft";
import type { RawTemplateDraft } from "@/domain/import/template-from-text";
import type { RawThemePromptDraft } from "@/domain/import/themes-from-text";
import type { Brand, Classification, DeckSpec, PromptTemplate } from "@/domain/schemas";

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
  /**
   * Même prompt avec les pistes de la trame du squelette raccourcies à
   * `skeletonDetailMax` caractères par diapo (0 = titres seuls) : ce qui compte
   * le moins, sacrifié en premier quand un modèle à contexte borné (Ollama) ne
   * peut pas tout recevoir.
   */
  compactPrompt?: (skeletonDetailMax: number) => PromptPair;
}

export interface ClassifyHints {
  themes: ThemeRef[];
  problem: string;
  hintedThemeId?: string | null;
}

/** Document envoyé à la vision (contenu base64, type vérifié par signature en amont). */
export interface BrandDocument {
  kind: "pdf" | "png" | "jpeg";
  base64: string;
}

export interface TemplateDraftHints {
  text: string;
  base: PromptTemplate;
}

export interface ThemePromptHints {
  text: string;
  brand: Brand;
}

export interface AiProvider {
  readonly name: string;
  /** Moteur, enregistré sur les decks produits (défaut côté service : "claude"). */
  readonly engine?: "claude" | "ollama" | "mock";
  generateDeck(prompt: PromptPair, hints?: DeckHints): Promise<DeckSpec>;
  classify(prompt: PromptPair, hints?: ClassifyHints): Promise<Classification>;
  /** Gabarit depuis des consignes : brouillon PERMISSIF (normalisé par l'appelant). Claude, Ollama, mock. */
  draftTemplate?(prompt: PromptPair, hints: TemplateDraftHints): Promise<RawTemplateDraft>;
  /** Thèmes et charte depuis un prompt libre : brouillon PERMISSIF (normalisé par l'appelant). Claude, Ollama, mock. */
  draftThemes?(prompt: PromptPair, hints: ThemePromptHints): Promise<RawThemePromptDraft>;
  /** Charte depuis un PDF ou une image (vision) : brouillon permissif. Claude et mock seulement. */
  deduceBrand?(document: BrandDocument): Promise<RawBrandDraft>;
}
