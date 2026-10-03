import { describe, expect, it } from "vitest";
import type { ProgramContext, ThemeRef } from "@/domain/contracts";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { defaultTemplate } from "@/domain/defaults";
import { buildFreeFinalDeck, buildFreeSkeleton, classifyProblemFree } from "@/domain/free";
import { sectionKind, twoColumnLabels } from "@/domain/free/skeleton";
import { DeckSpecSchema, LIMITS, type DeckSpec, type PromptTemplate, type Section } from "@/domain/schemas";
import { totalSlides } from "@/domain/slides";
import { makeProgram, makeTemplate } from "@/test/fixtures";
import { makeMasterProgram, makeMasterThemes } from "./master-program";

const program = makeMasterProgram();
const cyber = makeMasterThemes()[0];
const PROBLEM = "comment une PME peut-elle se protéger contre les rançongiciels";

function expectValid(deck: DeckSpec, template: PromptTemplate) {
  expect(DeckSpecSchema.safeParse(deck).success).toBe(true);
  expect(checkDeckAgainstTemplate(deck, template)).toEqual([]);
  expect(deck.slides).toHaveLength(totalSlides(template));
  for (const slide of deck.slides) {
    expect(slide.bullets.length).toBeLessThanOrEqual(LIMITS.bullets);
    for (const b of slide.bullets) expect(b.length).toBeLessThanOrEqual(LIMITS.bullet);
  }
}

function allText(deck: DeckSpec): string {
  return deck.slides.map((s) => [s.title, s.subtitle, ...s.bullets].join("\n")).join("\n");
}

/** Gabarit synthétique de `count` sections de `slides` diapos (ids et titres neutres). */
function syntheticTemplate(count: number, slides: number, overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  const sections: Section[] = Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    title: `Partie ${i + 1}`,
    guidance: i % 2 === 0 ? "Avantages et limites de l'approche." : "Analyse détaillée, avec un exemple.",
    slides,
  }));
  return { ...defaultTemplate(), sections, ...overrides };
}

const VARIED_TEMPLATES: Array<[string, PromptTemplate]> = [
  ["par défaut", defaultTemplate()],
  ["des fixtures", makeTemplate()],
  ["1 section × 1 diapo", syntheticTemplate(1, 1)],
  ["1 section × 8 diapos", syntheticTemplate(1, 8)],
  ["15 sections × 1 diapo", syntheticTemplate(15, 1)],
  ["7 sections × 8 diapos (57 diapos)", syntheticTemplate(7, 8)],
  ["15 sections × 3 diapos", syntheticTemplate(15, 3, { durationMinutes: 90 })],
  ["anglais", makeTemplate({ language: "en" })],
  [
    "intro et conclusion seules",
    {
      ...defaultTemplate(),
      sections: [
        { id: "intro", title: "Introduction", guidance: "", slides: 2 },
        { id: "conclusion", title: "Conclusion", guidance: "", slides: 2 },
      ],
    },
  ],
];

describe("buildFreeSkeleton — conformité", () => {
  it.each(VARIED_TEMPLATES)("devrait respecter le gabarit %s et le schéma", (_, template) => {
    expectValid(buildFreeSkeleton({ ...program, template }, cyber), template);
  });

  it.each(VARIED_TEMPLATES)("devrait produire un deck final conforme au gabarit %s", (_, template) => {
    const ctx = { ...program, template };
    expectValid(buildFreeFinalDeck(ctx, cyber, null, PROBLEM), template);
    expectValid(buildFreeFinalDeck(ctx, cyber, buildFreeSkeleton(ctx, cyber), PROBLEM), template);
  });

  it("devrait commencer par une couverture « cover » au layout title, puis suivre l'ordre des sections", () => {
    const deck = buildFreeSkeleton(program, cyber);
    expect(deck.slides[0]).toMatchObject({ sectionId: "cover", layout: "title", title: cyber.name });
    const expectedIds = program.template.sections.flatMap((s) => Array<string>(s.slides).fill(s.id));
    expect(deck.slides.slice(1).map((s) => s.sectionId)).toEqual(expectedIds);
  });

  it("devrait rester valide avec des données extrêmes (30 mots-clés de 60 caractères, description de 2000)", () => {
    const theme: ThemeRef = {
      id: "big",
      name: "T".repeat(120),
      description: "Description très longue. ".repeat(80).slice(0, 2000),
      keywords: Array.from({ length: 30 }, (_, i) => `${String(i).padStart(2, "0")}${"m".repeat(58)}`),
    };
    for (const [, template] of VARIED_TEMPLATES) {
      const ctx = { ...program, template };
      expectValid(buildFreeSkeleton(ctx, theme), template);
      expectValid(buildFreeFinalDeck(ctx, theme, null, `Comment ${"vraiment ".repeat(180)}?`), template);
    }
  });

  it("devrait rester valide pour un thème sans description ni mot-clé", () => {
    const bare: ThemeRef = { id: "bare", name: "Thème nu", description: "", keywords: [] };
    expectValid(buildFreeSkeleton(program, bare), program.template);
    expectValid(buildFreeFinalDeck(program, bare, null, PROBLEM), program.template);
  });

  it("devrait être déterministe et ne pas muter ses entrées", () => {
    const ctx: ProgramContext = makeMasterProgram();
    const snapshot = structuredClone(ctx);
    expect(buildFreeSkeleton(ctx, ctx.themes[0])).toEqual(buildFreeSkeleton(ctx, ctx.themes[0]));
    const skeleton = buildFreeSkeleton(ctx, ctx.themes[0]);
    const skeletonSnapshot = structuredClone(skeleton);
    buildFreeFinalDeck(ctx, ctx.themes[0], skeleton, PROBLEM);
    expect(ctx).toEqual(snapshot);
    expect(skeleton).toEqual(skeletonSnapshot);
  });
});

describe("buildFreeSkeleton — contenu", () => {
  it("devrait reprendre chaque mot-clé du thème et sa description", () => {
    const text = allText(buildFreeSkeleton(program, cyber));
    for (const keyword of cyber.keywords) expect(text).toContain(keyword);
    expect(text).toContain("Protection des systèmes d'information");
  });

  it("devrait répartir les mots-clés sur plusieurs sections de développement", () => {
    const deck = buildFreeSkeleton(program, cyber);
    const sectionsWithLeads = new Set(
      deck.slides.filter((s) => s.bullets.some((b) => b.startsWith("Pistes du thème"))).map((s) => s.sectionId),
    );
    expect(sectionsWithLeads.size).toBeGreaterThanOrEqual(2);
  });

  it("devrait marquer clairement les consignes de travail « À compléter »", () => {
    const deck = buildFreeSkeleton(program, cyber);
    const todos = deck.slides.flatMap((s) => s.bullets).filter((b) => b.startsWith("À compléter"));
    expect(todos.length).toBeGreaterThanOrEqual(program.template.sections.length);
    // Chaque diapo hors couverture invite à compléter ou apporte une donnée du thème.
    for (const slide of deck.slides.slice(1)) {
      expect(slide.bullets.some((b) => b.startsWith("À compléter") || b.startsWith("Pistes du thème") || b.startsWith("Cadre du thème") || b.includes(":"))).toBe(true);
    }
  });

  it("ne devrait contenir aucun chiffre qui ne vienne du gabarit ou du thème", () => {
    const deck = buildFreeSkeleton(program, cyber);
    const bullets = deck.slides.flatMap((s) => s.bullets).join(" ");
    // Seuls les numéros de partie du plan (« Partie 1 ») et les « 2 ou 3 » des consignes sont admis.
    const digits = bullets.replace(/Partie \d/g, "").replace(/2 ou 3/g, "").match(/\d/g);
    expect(digits).toBeNull();
  });

  it("devrait utiliser les layouts section, two-columns et conclusion selon les consignes", () => {
    const deck = buildFreeSkeleton(program, cyber);
    const bySection = (id: string) => deck.slides.filter((s) => s.sectionId === id).map((s) => s.layout);
    expect(bySection("part1")).toEqual(["section", "content", "content"]);
    expect(bySection("part3")).toEqual(["section", "two-columns"]); // « leviers d'action, limites »
    expect(bySection("conclusion")).toEqual(["conclusion"]);
    const twoCols = deck.slides.find((s) => s.layout === "two-columns");
    expect(twoCols?.title).toBe("Troisième axe : leviers et limites");
    expect(twoCols?.bullets).toHaveLength(4);
    expect(twoCols?.bullets[0]).toMatch(/^Leviers/);
    expect(twoCols?.bullets[2]).toMatch(/^Limites/);
  });

  it("devrait annoncer un plan en 2 à 3 parties dérivées des sections", () => {
    const plan = buildFreeSkeleton(program, cyber).slides.find((s) => s.sectionId === "plan");
    expect(plan?.bullets.slice(0, 3)).toEqual(["Partie 1 : Premier axe", "Partie 2 : Deuxième axe", "Partie 3 : Troisième axe"]);
    // La consigne de la section suit, marquée comme travail à faire.
    expect(plan?.bullets[3]).toMatch(/^À compléter : présenter les trois axes/);
  });

  it("devrait caler le minutage des notes sur la durée de l'oral, au format [m:ss–m:ss]", () => {
    const deck = buildFreeSkeleton(program, cyber);
    const ranges = deck.slides.map((s) => {
      const m = /^\[(\d+):(\d{2})–(\d+):(\d{2})\] \S/.exec(s.notes);
      expect(m, s.notes).not.toBeNull();
      const [, a, b, c, d] = m ?? [];
      return [Number(a) * 60 + Number(b), Number(c) * 60 + Number(d)];
    });
    expect(ranges[0][0]).toBe(0);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBe(ranges[i - 1][1]);
    expect(ranges[ranges.length - 1][1]).toBe(program.template.durationMinutes * 60);
  });

  it("devrait rédiger en anglais quand le gabarit est en anglais", () => {
    const ctx = { ...program, template: { ...defaultTemplate(), language: "en" as const } };
    const deck = buildFreeSkeleton(ctx, cyber);
    const text = allText(deck);
    expect(text).toContain("To complete:");
    expect(text).toContain("Theme leads:");
    expect(text).not.toContain("À compléter");
    expect(deck.slides[0].notes).toMatch(/Introduce yourself/);
  });
});

describe("buildFreeFinalDeck", () => {
  it("devrait mettre la problématique, nettoyée, en titre du deck et de la couverture", () => {
    const deck = buildFreeFinalDeck(program, cyber, null, PROBLEM);
    const expected = "Comment une PME peut-elle se protéger contre les rançongiciels ?";
    expect(deck.title).toBe(expected);
    expect(deck.slides[0].title).toBe(expected);
    expect(deck.slides[0].subtitle).toContain(cyber.name);
  });

  it("devrait poser la problématique en introduction et demander d'y répondre en conclusion", () => {
    const deck = buildFreeFinalDeck(program, cyber, null, PROBLEM);
    const intro = deck.slides.find((s) => s.sectionId === "intro");
    const problem = deck.slides.find((s) => s.sectionId === "problem");
    const conclusion = deck.slides.find((s) => s.sectionId === "conclusion");
    expect(intro?.bullets.some((b) => b.startsWith("Problématique posée : Comment une PME"))).toBe(true);
    expect(intro?.bullets.some((b) => b.startsWith("Termes de la problématique à définir : PME, protéger, rançongiciels"))).toBe(true);
    expect(problem?.bullets[0]).toBe(deck.title);
    expect(conclusion?.bullets[0]).toBe(`Répondre explicitement à : ${deck.title}`);
    expect(conclusion?.bullets).toContain("À compléter : la réponse explicite à la problématique (oui, non, à quelles conditions)");
  });

  it("devrait reprendre les diapos de développement d'un squelette conforme, minutage recalculé", () => {
    const skeleton = buildFreeSkeleton(program, cyber);
    const edited: DeckSpec = {
      ...skeleton,
      slides: skeleton.slides.map((s) =>
        s.sectionId === "part2" && s.layout === "content" ? { ...s, title: "Titre retravaillé", bullets: ["Idée rédigée"], notes: "[9:99–9:99] Texte" } : s,
      ),
    };
    const deck = buildFreeFinalDeck(program, cyber, edited, PROBLEM);
    const reused = deck.slides.filter((s) => s.title === "Titre retravaillé");
    expect(reused).toHaveLength(2);
    expect(reused[0].bullets).toEqual(["À compléter : en quoi cette diapo répond à la problématique", "Idée rédigée"]);
    expect(reused[0].notes).toMatch(/^\[\d+:\d{2}–\d+:\d{2}\] Texte$/);
    expect(reused[0].notes).not.toContain("9:99");
  });

  // B2 : l'ajout de la puce de lien en tête, puis la coupe à 6, supprimait la 6e puce de l'utilisateur.
  it("ne devrait jamais supprimer une puce de l'utilisateur : sans place, la consigne de lien passe dans les notes", () => {
    const skeleton = buildFreeSkeleton(program, cyber);
    const six = ["Un", "Deux", "Trois", "Quatre", "Cinq", "Six"];
    const edited: DeckSpec = {
      ...skeleton,
      slides: skeleton.slides.map((s) =>
        s.sectionId === "part2" && s.layout === "content" ? { ...s, title: "Pleine", bullets: six, notes: "[0:00–0:01] Texte" } : s,
      ),
    };
    const deck = buildFreeFinalDeck(program, cyber, edited, PROBLEM);
    const full = deck.slides.filter((s) => s.title === "Pleine");
    expect(full.length).toBeGreaterThan(0);
    for (const slide of full) {
      expect(slide.bullets).toEqual(six);
      expect(slide.notes).toContain("en quoi cette diapo répond à la problématique");
    }
    expectValid(deck, program.template);
  });

  it("devrait ignorer un squelette non conforme au gabarit et tout régénérer", () => {
    const foreign = buildFreeSkeleton(makeProgram(), makeProgram().themes[0]);
    const deck = buildFreeFinalDeck(program, cyber, foreign, PROBLEM);
    expect(deck).toEqual(buildFreeFinalDeck(program, cyber, null, PROBLEM));
  });

  it("devrait retomber sur le nom du thème si la problématique est vide", () => {
    const deck = buildFreeFinalDeck(program, cyber, null, "   ");
    expect(deck.title).toBe(cyber.name);
    expectValid(deck, program.template);
  });

  it("devrait s'enchaîner avec la classification gratuite", () => {
    const { ranked, reformulatedProblem } = classifyProblemFree(program, PROBLEM);
    const theme = program.themes.find((t) => t.id === ranked[0].themeId);
    expect(theme?.id).toBe("cyber");
    const deck = buildFreeFinalDeck(program, theme ?? cyber, null, reformulatedProblem);
    expect(deck.title).toBe(reformulatedProblem);
  });
});

describe("lecture du gabarit", () => {
  it.each([
    [{ id: "intro", title: "Introduction" }, "intro"],
    [{ id: "s1", title: "Accroche" }, "intro"],
    [{ id: "problem", title: "Problématique" }, "problem"],
    [{ id: "plan", title: "Annonce du plan" }, "plan"],
    [{ id: "p", title: "Plan d'action" }, "part"],
    [{ id: "conclusion", title: "Conclusion" }, "conclusion"],
    [{ id: "end", title: "Synthèse et ouverture" }, "conclusion"],
    [{ id: "part1", title: "Premier axe" }, "part"],
  ] as const)("devrait classer %o comme %s", (section, kind) => {
    expect(sectionKind(section)).toBe(kind);
  });

  it("devrait reconnaître une consigne qui oppose deux notions", () => {
    expect(twoColumnLabels({ title: "Bilan", guidance: "Enjeux et risques pour l'entreprise." })).toEqual(["Enjeux", "Risques"]);
    expect(twoColumnLabels({ title: "Analyse", guidance: "Avantages, inconvénients." })).toEqual(["Avantages", "Inconvénients"]);
    expect(twoColumnLabels({ title: "Analysis", guidance: "Benefits and risks." }, "en")).toEqual(["Benefits", "Risks"]);
    expect(twoColumnLabels({ title: "Analyse", guidance: "Causes et mécanismes." })).toBeNull();
    expect(twoColumnLabels({ title: "Comparaison des deux modèles", guidance: "" })).toEqual(["Premier terme", "Second terme"]);
    expect(twoColumnLabels({ title: "Comparison", guidance: "" }, "en")).toEqual(["First option", "Second option"]);
  });
});

describe("deck gratuit — couverture et intercalaires", () => {
  const theme: ThemeRef = { id: "g", name: "Green IT", description: "", keywords: [] };
  const problem = "Le Green IT peut-il réellement réduire l'empreinte environnementale du numérique ?";

  it("ne devrait pas répéter le thème dans le sous-titre quand le projet porte déjà son nom", () => {
    const ctx = makeProgram({ name: "Green IT — Gratuit" });
    const deck = buildFreeFinalDeck(ctx, theme, null, problem);
    expect(deck.slides[0]!.subtitle).toBe("Green IT — Gratuit");
  });

  it("devrait garder thème et projet quand ils diffèrent", () => {
    const deck = buildFreeFinalDeck(makeProgram({ name: "Grand oral 2026" }), theme, null, problem);
    expect(deck.slides[0]!.subtitle).toBe("Green IT — Grand oral 2026");
  });

  it("devrait rendre une section « Intercalaire » d'une diapo en diapo de section", () => {
    const template = makeTemplate({
      sections: [
        { id: "intro", title: "Introduction", guidance: "", slides: 1 },
        { id: "inter-1", title: "Intercalaire Partie I", guidance: "Titre de partie + les diapos qu'elle contient", slides: 1 },
        { id: "p1", title: "Partie I — l'état des lieux", guidance: "Le constat mesuré", slides: 2 },
        { id: "conclusion", title: "Conclusion", guidance: "", slides: 1 },
      ],
    });
    const deck = buildFreeSkeleton(makeProgram({ template }), theme);
    expectValid(deck, template);
    expect(deck.slides[2]!.layout).toBe("section");
  });
});
