import type { Brand, Classification, DeckSpec, PromptTemplate, Section, Slide } from "./schemas";

/**
 * Signatures des fonctions pures du domaine (implémentées dans src/domain/*.ts,
 * sans accès réseau ni base). Les tests unitaires s'écrivent contre ces signatures.
 */

export interface ThemeRef {
  id: string;
  name: string;
  description: string;
  keywords: string[];
}

export interface ProgramContext {
  name: string;
  description: string;
  themes: ThemeRef[];
  template: PromptTemplate;
}

export interface PromptPair {
  system: string;
  user: string;
}

export interface RankedTheme {
  themeId: string;
  themeName: string;
  /** Entre 0 et 1, arrondi à 2 décimales. */
  confidence: number;
  rationale: string;
}

export interface ClassificationResult {
  reformulatedProblem: string;
  /** Au plus 3, uniquement des thèmes du programme, triés par confiance décroissante — sauf le thème annoncé (hintedThemeId), toujours placé en tête. */
  ranked: RankedTheme[];
}

export type DomainFns = {
  /** src/domain/slides.ts — nombre de diapos conseillé pour une durée d'oral (≈ 1 diapo / 1,5 min, borné 5..30). */
  suggestSlideCount(durationMinutes: number): number;
  /** src/domain/slides.ts — total de diapos produit par le gabarit : 1 couverture + somme des sections. */
  totalSlides(template: PromptTemplate): number;
  /** src/domain/prompts.ts */
  buildSkeletonPrompt(ctx: ProgramContext, theme: ThemeRef): PromptPair;
  /** src/domain/prompts.ts */
  buildFinalDeckPrompt(ctx: ProgramContext, theme: ThemeRef, skeleton: DeckSpec | null, problem: string): PromptPair;
  /** src/domain/prompts.ts */
  buildClassificationPrompt(ctx: ProgramContext, problem: string): PromptPair;
  /** src/domain/classification.ts — filtre les ids inconnus, dédoublonne, borne [0,1], trie, garde 3. */
  normalizeClassification(raw: Classification, themes: ThemeRef[], hintedThemeId?: string | null): ClassificationResult;
  /** src/domain/deck.ts — vérifie qu'un deck respecte le gabarit (une couverture en tête, sections présentes). Retourne la liste des écarts. */
  checkDeckAgainstTemplate(deck: DeckSpec, template: PromptTemplate): string[];
  /** src/domain/canva.ts — texte prêt à coller dans l'IA de Canva (charte + contenu diapo par diapo). */
  buildCanvaPrompt(deck: DeckSpec, brand: Brand, template: PromptTemplate): string;
  /** src/domain/defaults.ts — gabarit, charte neutre par défaut et sections par défaut. */
  defaultTemplate(): PromptTemplate;
  defaultBrand(): Brand;
  defaultSections(): Section[];
  /** src/domain/deck.ts — remplace une diapo par index, sans muter l'entrée. */
  replaceSlide(deck: DeckSpec, index: number, slide: Slide): DeckSpec;
};

/**
 * Résultat de la reconnaissance tel que renvoyé au client : `source` dit qui
 * l'a produit ; `fallbackReason` (FR, affichable) explique un repli sur la
 * reconnaissance sans IA, null sinon (y compris quand le moteur gratuit est choisi).
 */
export interface ClassificationOutcome extends ClassificationResult {
  source: "ai" | "free";
  fallbackReason: string | null;
}
