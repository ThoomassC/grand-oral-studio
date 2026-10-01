import type { Brand, DeckSpec, PromptTemplate, SlideLayout } from "./schemas";

/**
 * Texte prêt à coller dans l'assistant IA de Canva : la charte (couleurs,
 * polices, format, logo) puis le contenu diapo par diapo. Fonction pure.
 * Le logo n'est jamais recopié (data URL) : on indique seulement qu'il est à
 * importer et où le placer.
 */

const LABELS = {
  fr: {
    intro:
      "Crée une présentation à partir du contenu ci-dessous. Respecte strictement la charte graphique, garde le texte tel quel " +
      "(ne le réécris pas, n'ajoute pas de diapo) et laisse les notes d'orateur dans les notes de chaque page.",
    deck: "Présentation",
    format: "Format",
    brand: "Charte graphique",
    colors: { primary: "Couleur principale", secondary: "Couleur secondaire", accent: "Couleur d'accent", background: "Fond", text: "Texte" },
    heading: "Police des titres",
    body: "Police du texte",
    logo: "Logo : importe le logo fourni séparément et place-le en haut à droite de chaque diapo, sans le déformer.",
    noLogo: "Logo : aucun.",
    slides: "Diapos",
    slide: "Diapo",
    layout: "mise en page",
    subtitle: "Sous-titre",
    bullets: "Puces",
    notes: "Notes d'orateur",
    layouts: {
      title: "couverture",
      section: "intercalaire de partie",
      content: "liste de puces",
      "two-columns": "deux colonnes (puces réparties à gauche et à droite)",
      conclusion: "conclusion",
    } satisfies Record<SlideLayout, string>,
  },
  en: {
    intro:
      "Create a presentation from the content below. Follow the brand guidelines strictly, keep the text as is (do not rewrite it, " +
      "do not add slides) and put the speaker notes in each page's notes.",
    deck: "Presentation",
    format: "Format",
    brand: "Brand guidelines",
    colors: { primary: "Primary colour", secondary: "Secondary colour", accent: "Accent colour", background: "Background", text: "Text" },
    heading: "Heading font",
    body: "Body font",
    logo: "Logo: import the logo provided separately and place it in the top right corner of every slide, without distorting it.",
    noLogo: "Logo: none.",
    slides: "Slides",
    slide: "Slide",
    layout: "layout",
    subtitle: "Subtitle",
    bullets: "Bullets",
    notes: "Speaker notes",
    layouts: {
      title: "cover",
      section: "section divider",
      content: "bullet list",
      "two-columns": "two columns (bullets split left and right)",
      conclusion: "conclusion",
    } satisfies Record<SlideLayout, string>,
  },
} as const;

function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export function buildCanvaPrompt(deck: DeckSpec, brand: Brand, template: PromptTemplate): string {
  const l = LABELS[template.language];
  const total = deck.slides.length;
  const lines: string[] = [
    l.intro,
    "",
    `${l.deck} : ${oneLine(deck.title)}${deck.subtitle ? ` — ${oneLine(deck.subtitle)}` : ""}`,
    `${l.format} : ${template.format}`,
    "",
    `${l.brand} (${oneLine(brand.name)}) :`,
    `- ${l.colors.primary} : ${brand.colors.primary.toUpperCase()}`,
    `- ${l.colors.secondary} : ${brand.colors.secondary.toUpperCase()}`,
    `- ${l.colors.accent} : ${brand.colors.accent.toUpperCase()}`,
    `- ${l.colors.background} : ${brand.colors.background.toUpperCase()}`,
    `- ${l.colors.text} : ${brand.colors.text.toUpperCase()}`,
    `- ${l.heading} : ${brand.fonts.heading}`,
    `- ${l.body} : ${brand.fonts.body}`,
    `- ${brand.logoDataUrl ? l.logo : l.noLogo}`,
    "",
    `${l.slides} :`,
  ];

  deck.slides.forEach((slide, i) => {
    lines.push("");
    lines.push(`${l.slide} ${i + 1}/${total} — ${oneLine(slide.title)} (${l.layout} : ${l.layouts[slide.layout]})`);
    if (slide.subtitle) lines.push(`${l.subtitle} : ${oneLine(slide.subtitle)}`);
    if (slide.bullets.length > 0) {
      lines.push(`${l.bullets} :`);
      for (const bullet of slide.bullets) lines.push(`• ${oneLine(bullet)}`);
    }
    if (slide.notes) lines.push(`${l.notes} : ${slide.notes.trim()}`);
  });

  return lines.join("\n");
}
