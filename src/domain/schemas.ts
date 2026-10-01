import { z } from "zod";

/**
 * Contrats du domaine. Toute donnée qui traverse une frontière (formulaire,
 * base JSON, réponse de l'IA) est validée par l'un de ces schémas.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB");

export const ThemeInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
});
export type ThemeInput = z.infer<typeof ThemeInputSchema>;

export const BrandSchema = z.object({
  name: z.string().trim().min(1).max(80),
  colors: z.object({
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    background: hexColor,
    text: hexColor,
  }),
  fonts: z.object({
    heading: z.string().trim().min(1).max(60),
    body: z.string().trim().min(1).max(60),
  }),
  /** Logo en data URL PNG/JPEG/SVG, 500 Ko max une fois encodé. */
  logoDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/)
    .max(700_000)
    .nullable()
    .default(null),
});
export type Brand = z.infer<typeof BrandSchema>;

export const SectionSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  /** Consigne donnée à l'IA pour cette section. */
  guidance: z.string().trim().max(600).default(""),
  slides: z.number().int().min(1).max(8),
});
export type Section = z.infer<typeof SectionSchema>;

export const PromptTemplateSchema = z.object({
  format: z.enum(["16:9", "4:3"]),
  language: z.enum(["fr", "en"]),
  durationMinutes: z.number().int().min(3).max(90),
  sections: z.array(SectionSchema).min(1).max(15),
  tone: z.string().trim().max(200).default(""),
  constraints: z.string().trim().max(2000).default(""),
});
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

export const SlideLayoutSchema = z.enum(["title", "section", "content", "two-columns", "conclusion"]);
export type SlideLayout = z.infer<typeof SlideLayoutSchema>;

export const SlideSchema = z.object({
  layout: SlideLayoutSchema,
  /** Identifiant de la section du gabarit dont la diapo est issue ("cover" pour la couverture). */
  sectionId: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(140),
  subtitle: z.string().trim().max(200).default(""),
  bullets: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  notes: z.string().trim().max(3000).default(""),
});
export type Slide = z.infer<typeof SlideSchema>;

export const DeckSpecSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(240).default(""),
  slides: z.array(SlideSchema).min(2).max(60),
});
export type DeckSpec = z.infer<typeof DeckSpecSchema>;

/** Réponse brute de l'IA pour la reconnaissance du thème. */
export const ClassificationSchema = z.object({
  reformulatedProblem: z.string().trim().min(1).max(600),
  candidates: z
    .array(
      z.object({
        themeId: z.string().min(1),
        confidence: z.number(),
        rationale: z.string().trim().max(600),
      }),
    )
    .min(1)
    .max(10),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const ProblemInputSchema = z.object({
  problem: z.string().trim().min(10).max(1500),
  /** Thème annoncé avec la problématique, s'il y en a un. */
  hintedThemeId: z.string().min(1).nullable().default(null),
});
export type ProblemInput = z.infer<typeof ProblemInputSchema>;
