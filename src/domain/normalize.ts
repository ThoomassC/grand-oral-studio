import { z } from "zod";
import { LIMITS, SlideLayoutSchema, stripControlChars, type Classification, type DeckSpec, type Slide, type SlideLayout } from "./schemas";

/**
 * Normalisation des réponses de l'IA — fonctions pures.
 *
 * La sortie structurée garantit la FORME du JSON, pas les longueurs ni les
 * cardinalités. On demande donc au modèle un schéma permissif (sans bornes),
 * puis on ramène la réponse dans les bornes du domaine (troncature propre,
 * puces vides retirées, plafonds) avant la validation stricte. Une réponse un
 * peu trop longue ne fait ainsi jamais échouer une génération.
 */

// ---------------------------------------------------------------------------
// Schémas permissifs (envoyés au modèle comme format de sortie)
// ---------------------------------------------------------------------------

export const RawSlideSchema = z.object({
  /** Chaîne libre : le helper du SDK transforme les enums en simple description. */
  layout: z.string(),
  sectionId: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const RawDeckSpecSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  slides: z.array(RawSlideSchema),
});
export type RawDeckSpec = z.infer<typeof RawDeckSpecSchema>;

export const RawClassificationSchema = z.object({
  reformulatedProblem: z.string(),
  candidates: z.array(z.object({ themeId: z.string(), confidence: z.number(), rationale: z.string() })),
});
export type RawClassification = z.infer<typeof RawClassificationSchema>;

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const ELLIPSIS = "…";

function clean(value: string | undefined): string {
  return stripControlChars(value ?? "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Tronque à `max` caractères (ellipse comprise), de préférence à une frontière
 * de mot si elle n'éloigne pas trop de la limite.
 */
export function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  const room = max - ELLIPSIS.length;
  const cut = value.slice(0, room + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace >= room * 0.6 ? cut.slice(0, lastSpace) : value.slice(0, room);
  return `${base.trimEnd().replace(/[\s,;:.–—-]+$/, "")}${ELLIPSIS}`;
}

function bounded(value: string | undefined, max: number): string {
  return truncateText(clean(value), max);
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export function normalizeSlide(raw: z.infer<typeof RawSlideSchema>, index: number): Slide {
  const title = bounded(raw.title, LIMITS.slideTitle);
  const sectionId = clean(raw.sectionId).slice(0, LIMITS.sectionId);
  const known = SlideLayoutSchema.safeParse(clean(raw.layout).toLowerCase());
  const layout: SlideLayout = known.success ? known.data : index === 0 ? "title" : "content";
  return {
    layout,
    sectionId: sectionId || (layout === "title" ? "cover" : "section"),
    title: title || `Diapo ${index + 1}`,
    subtitle: bounded(raw.subtitle, LIMITS.slideSubtitle),
    bullets: (raw.bullets ?? [])
      .map((b) => bounded(b, LIMITS.bullet))
      .filter((b) => b.length > 0)
      .slice(0, LIMITS.bullets),
    // Les notes gardent leurs sauts de ligne.
    notes: truncateText(stripControlChars(raw.notes ?? "").trim(), LIMITS.notes),
  };
}

export function normalizeDeckSpec(raw: RawDeckSpec): DeckSpec {
  const slides = raw.slides.slice(0, LIMITS.maxSlides).map(normalizeSlide);
  return {
    title: bounded(raw.title, LIMITS.deckTitle) || slides[0]?.title || "Diaporama",
    subtitle: bounded(raw.subtitle, LIMITS.deckSubtitle),
    slides,
  };
}

export function normalizeRawClassification(raw: RawClassification): Classification {
  return {
    reformulatedProblem: bounded(raw.reformulatedProblem, LIMITS.reformulated),
    candidates: raw.candidates.slice(0, LIMITS.candidates).map((c) => ({
      themeId: c.themeId.trim(),
      confidence: c.confidence,
      rationale: bounded(c.rationale, LIMITS.rationale),
    })),
  };
}
