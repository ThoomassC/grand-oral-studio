import type { PromptPair, ThemeRef } from "@/domain/contracts";
import {
  ClassificationSchema,
  DeckSpecSchema,
  LIMITS,
  type Classification,
  type DeckSpec,
  type Slide,
  type SlideLayout,
} from "@/domain/schemas";
import { AiInvalidOutputError } from "../errors";
import type { RawBrandDraft } from "@/domain/import/brand-from-draft";
import { parseTemplateText, type RawTemplateDraft } from "@/domain/import/template-from-text";
import type { AiProvider, ClassifyHints, DeckHints, TemplateDraftHints } from "./types";

/**
 * Fournisseur déterministe, sans réseau : même entrée → même sortie. Sert au dev
 * sans clé et aux tests E2E. Il s'appuie sur les `hints` structurés (gabarit,
 * thème, problématique) plutôt que d'analyser le texte du prompt.
 */

const MAX_SLIDES = 60;

const STOPWORDS = new Set(
  (
    "le la les un une des du de d l au aux et ou en dans sur pour par avec sans sous " +
    "ce cet cette ces son sa ses leur leurs que qui quoi dont est sont etre peut faut " +
    "comment pourquoi quel quelle quels quelles plus moins tres aussi ainsi entre " +
    "the a an of to in on for and or is are how why what"
  ).split(" "),
);

/** Normalise et découpe en mots significatifs (minuscules, sans accents, ≥ 3 lettres). */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function layoutFor(sectionIndex: number, sectionCount: number, slideIndex: number): SlideLayout {
  if (sectionIndex === sectionCount - 1) return "conclusion";
  if (slideIndex === 0) return "section";
  return slideIndex % 2 === 0 ? "two-columns" : "content";
}

function buildDeck(h: DeckHints): DeckSpec {
  const { template, theme, problem } = h;
  const en = template.language === "en";
  const keywords = theme.keywords.length > 0 ? theme.keywords : tokenize(`${theme.name} ${theme.description}`).slice(0, 6);
  const slides: Slide[] = [
    {
      layout: "title",
      sectionId: "cover",
      title: clip(problem ?? theme.name, 140),
      subtitle: clip(problem ? theme.name : h.programName, 200),
      bullets: [],
      notes: clip(
        problem
          ? `${en ? "Introduce the question" : "Annoncer la problématique"} : « ${problem} »`
          : `${en ? "Introduce the theme" : "Présenter le thème"} « ${theme.name} ».`,
        3000,
      ),
    },
  ];

  const sections = template.sections;
  sections.forEach((section, si) => {
    for (let k = 0; k < section.slides && slides.length < MAX_SLIDES; k += 1) {
      const kw = keywords.length > 0 ? keywords[(si + k) % keywords.length] : theme.name;
      const skeletonSlide = h.skeleton?.slides.find((s) => s.sectionId === section.id);
      const bullets = [
        clip(`${section.title} — ${kw}`, LIMITS.bullet),
        clip(section.guidance || (en ? `Key idea on ${theme.name}` : `Idée clé sur ${theme.name}`), LIMITS.bullet),
        ...(skeletonSlide?.bullets.slice(0, 2) ?? []),
      ].slice(0, Math.min(4, LIMITS.bullets));
      slides.push({
        layout: layoutFor(si, sections.length, k),
        sectionId: section.id,
        title: clip(section.slides > 1 ? `${section.title} (${k + 1}/${section.slides})` : section.title, 140),
        subtitle: "",
        bullets,
        notes: problem
          ? clip(
              `${en ? "Link to the question" : "Relier à la problématique"} « ${problem} » : ${section.title.toLowerCase()}, ${kw}.`,
              3000,
            )
          : "",
      });
    }
  });

  const deck = {
    title: clip(problem ? `${theme.name} — ${problem}` : theme.name, 160),
    subtitle: clip(h.programName, 240),
    slides,
  };
  const parsed = DeckSpecSchema.safeParse(deck);
  if (!parsed.success) throw new AiInvalidOutputError("mock: deck hors schéma", { cause: parsed.error });
  return parsed.data;
}

/** Score de recouvrement : mots-clés ×2, nom ×1.5, description ×1. */
export function overlapScore(problemTokens: Set<string>, theme: ThemeRef): number {
  let score = 0;
  const count = (tokens: string[], weight: number) => {
    for (const t of new Set(tokens)) if (problemTokens.has(t)) score += weight;
  };
  count(theme.keywords.flatMap(tokenize), 2);
  count(tokenize(theme.name), 1.5);
  count(tokenize(theme.description), 1);
  return score;
}

function buildClassification(h: ClassifyHints): Classification {
  if (h.themes.length === 0) {
    throw new AiInvalidOutputError("mock: aucun thème à classer");
  }
  const tokens = new Set(tokenize(h.problem));
  const scored = h.themes
    .map((theme, order) => {
      const raw = overlapScore(tokens, theme) + (theme.id === h.hintedThemeId ? 3 : 0);
      return { theme, raw, order };
    })
    .sort((a, b) => b.raw - a.raw || a.order - b.order);
  const best = scored[0]?.raw ?? 0;
  const picked = (best > 0 ? scored.filter((s) => s.raw > 0) : scored).slice(0, 10);

  const result = {
    reformulatedProblem: clip(h.problem.replace(/\s+/g, " ").trim(), 600),
    candidates: picked.map((s) => ({
      themeId: s.theme.id,
      confidence: best > 0 ? Math.round((s.raw / (best + 2)) * 100) / 100 : 0.1,
      rationale: clip(
        s.raw > 0
          ? `Mots en commun avec le thème « ${s.theme.name} ».`
          : `Aucun mot-clé commun ; « ${s.theme.name} » proposé par défaut.`,
        600,
      ),
    })),
  };
  const parsed = ClassificationSchema.safeParse(result);
  if (!parsed.success) throw new AiInvalidOutputError("mock: classification hors schéma", { cause: parsed.error });
  return parsed.data;
}

export function createMockProvider(): AiProvider {
  return {
    name: "mock",
    engine: "mock",
    async generateDeck(_prompt: PromptPair, hints?: DeckHints): Promise<DeckSpec> {
      if (!hints) throw new AiInvalidOutputError("mock: hints requis pour generateDeck");
      return buildDeck(hints);
    },
    async draftTemplate(_prompt: PromptPair, hints: TemplateDraftHints): Promise<RawTemplateDraft> {
      // Déterministe : les heuristiques du moteur gratuit, présentées comme un brouillon d'IA.
      const { template } = parseTemplateText(hints.text, hints.base);
      return { ...template };
    },
    async deduceBrand(): Promise<RawBrandDraft> {
      return {
        name: "Charte simulée",
        colors: { primary: "#1E3A5F", secondary: "#4A6A8A", accent: "#D9822B", background: "#FFFFFF", text: "#1F2933" },
        headingFont: "Georgia",
        bodyFont: "Arial",
      };
    },
    async classify(_prompt: PromptPair, hints?: ClassifyHints): Promise<Classification> {
      if (!hints) throw new AiInvalidOutputError("mock: hints requis pour classify");
      return buildClassification(hints);
    },
  };
}
