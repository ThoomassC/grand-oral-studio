import { describe, expect, it } from "vitest";
import type { ProgramContext, ThemeRef } from "@/domain/contracts";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { defaultTemplate } from "@/domain/defaults";
import { buildFreeFinalDeck, classifyProblemFree } from "@/domain/free";
import { OUTLINE_TEXTS, sectionKind, splitSubjectNotes, twoColumnLabels } from "@/domain/free/outline";
import { DeckSpecSchema, LIMITS, type DeckSpec, type PromptTemplate, type Section } from "@/domain/schemas";
import { formatSeconds, templateTimings, totalSlides } from "@/domain/slides";
import { makeProgram, makeTemplate } from "@/test/fixtures";
import { makeMasterProgram, makeMasterThemes } from "./master-program";

const program = makeMasterProgram();
const cyber = makeMasterThemes()[0]!;
const PROBLEM = "comment une PME peut-elle se protéger contre les rançongiciels";
const CLEAN_PROBLEM = "Comment une PME peut-elle se protéger contre les rançongiciels\u00a0?";

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

function withNotes(notes: string, base: ThemeRef = cyber): ThemeRef {
  return { ...base, notes };
}

/** Trame synthétique de `count` sections de `slides` diapos (ids et titres neutres). */
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
  [
    "avec durées fixées",
    {
      ...defaultTemplate(),
      sections: defaultTemplate().sections.map((s) => (s.id === "part1" ? { ...s, seconds: 300 } : s.id === "conclusion" ? { ...s, seconds: 90 } : s)),
    },
  ],
];

const NOTES_SAMPLE = [
  "- 37 % des PME attaquées en 2023 (Cybermalveillance.gouv.fr, Rapport d'activité, 2024)",
  "* Exemple : l'hôpital de Corbeil-Essonnes, août 2022",
  "1. Sauvegardes hors ligne testées chaque mois",
  "2) Plan de reprise d'activité",
].join("\n");

describe("buildFreeFinalDeck — conformité", () => {
  it.each(VARIED_TEMPLATES)("devrait respecter la trame %s et le schéma, avec ou sans sujet", (_, template) => {
    const ctx = { ...program, template };
    expectValid(buildFreeFinalDeck(ctx, cyber, PROBLEM), template);
    expectValid(buildFreeFinalDeck(ctx, withNotes(NOTES_SAMPLE), PROBLEM), template);
    expectValid(buildFreeFinalDeck(ctx, null, PROBLEM), template);
  });

  it("devrait commencer par une couverture « cover » au layout title, puis suivre l'ordre des lignes", () => {
    const deck = buildFreeFinalDeck(program, cyber, PROBLEM);
    expect(deck.slides[0]).toMatchObject({ sectionId: "cover", layout: "title", title: CLEAN_PROBLEM });
    const expectedIds = program.template.sections.flatMap((s) => Array<string>(s.slides).fill(s.id));
    expect(deck.slides.slice(1).map((s) => s.sectionId)).toEqual(expectedIds);
  });

  it("devrait rester valide avec des données extrêmes (30 mots-clés de 60 caractères, description de 2000, notes de 4000)", () => {
    const theme: ThemeRef = {
      id: "big",
      name: "T".repeat(120),
      description: "Description très longue. ".repeat(80).slice(0, 2000),
      keywords: Array.from({ length: 30 }, (_, i) => `${String(i).padStart(2, "0")}${"m".repeat(58)}`),
      notes: Array.from({ length: 80 }, (_, i) => `- Élément de note numéro ${i} ${"x".repeat(40)}`).join("\n").slice(0, 4000),
    };
    for (const [, template] of VARIED_TEMPLATES) {
      const ctx = { ...program, template };
      expectValid(buildFreeFinalDeck(ctx, theme, `Comment ${"vraiment ".repeat(180)}?`), template);
    }
  });

  it("devrait rester valide pour un sujet sans description, mot-clé ni notes", () => {
    const bare: ThemeRef = { id: "bare", name: "Sujet nu", description: "", keywords: [], notes: "" };
    expectValid(buildFreeFinalDeck(program, bare, PROBLEM), program.template);
  });

  it("devrait être déterministe et ne pas muter ses entrées", () => {
    const ctx: ProgramContext = makeMasterProgram();
    const subject = withNotes(NOTES_SAMPLE, ctx.themes[0]!);
    const snapshot = structuredClone(ctx);
    const subjectSnapshot = structuredClone(subject);
    expect(buildFreeFinalDeck(ctx, subject, PROBLEM)).toEqual(buildFreeFinalDeck(ctx, subject, PROBLEM));
    expect(ctx).toEqual(snapshot);
    expect(subject).toEqual(subjectSnapshot);
  });
});

describe("buildFreeFinalDeck — contenu tiré du sujet et de la trame", () => {
  it("devrait reprendre chaque mot-clé du sujet et sa description", () => {
    const text = allText(buildFreeFinalDeck(program, cyber, PROBLEM));
    for (const keyword of cyber.keywords) expect(text).toContain(keyword);
    expect(text).toContain("Cadre du sujet : Protection des systèmes d'information");
  });

  it("devrait répartir les mots-clés sur plusieurs lignes de développement", () => {
    const deck = buildFreeFinalDeck(program, cyber, PROBLEM);
    const sectionsWithLeads = new Set(
      deck.slides.filter((s) => s.bullets.some((b) => b.startsWith("Pistes du sujet"))).map((s) => s.sectionId),
    );
    expect(sectionsWithLeads.size).toBeGreaterThanOrEqual(2);
  });

  it("devrait marquer clairement le travail à faire « À compléter »", () => {
    const deck = buildFreeFinalDeck(program, cyber, PROBLEM);
    const todos = deck.slides.flatMap((s) => s.bullets).filter((b) => b.startsWith("À compléter"));
    expect(todos.length).toBeGreaterThanOrEqual(program.template.sections.length);
  });

  it("devrait développer le contenu type de chaque ligne en consignes « À compléter »", () => {
    const deck = buildFreeFinalDeck(program, cyber, PROBLEM);
    const plan = deck.slides.find((s) => s.sectionId === "plan");
    expect(plan?.bullets.slice(0, 3)).toEqual(["Partie 1 : Premier axe", "Partie 2 : Deuxième axe", "Partie 3 : Troisième axe"]);
    expect(plan?.bullets[3]).toMatch(/^À compléter : présenter les trois axes/);
  });

  it("ne devrait contenir aucun chiffre qui ne vienne de la trame, du sujet ou de la problématique", () => {
    const bullets = buildFreeFinalDeck(program, cyber, PROBLEM).slides.flatMap((s) => s.bullets).join(" ");
    // Seuls les numéros de partie du plan (« Partie 1 ») et les « 2 ou 3 » des consignes sont admis.
    expect(bullets.replace(/Partie \d/g, "").replace(/2 ou 3/g, "").match(/\d/g)).toBeNull();
  });

  it("devrait utiliser les layouts section, two-columns et conclusion selon le contenu type", () => {
    const deck = buildFreeFinalDeck(program, cyber, PROBLEM);
    const bySection = (id: string) => deck.slides.filter((s) => s.sectionId === id).map((s) => s.layout);
    expect(bySection("part1")).toEqual(["section", "content", "content"]);
    expect(bySection("part3")).toEqual(["section", "two-columns"]); // « leviers d'action, limites »
    expect(bySection("conclusion")).toEqual(["conclusion"]);
    const twoCols = deck.slides.find((s) => s.layout === "two-columns");
    expect(twoCols?.title).toBe("Troisième axe : leviers et limites");
    expect(twoCols?.bullets).toHaveLength(4);
  });

  it("devrait poser la problématique en introduction et demander d'y répondre en conclusion", () => {
    const deck = buildFreeFinalDeck(program, cyber, PROBLEM);
    const intro = deck.slides.find((s) => s.sectionId === "intro");
    const problem = deck.slides.find((s) => s.sectionId === "problem");
    const conclusion = deck.slides.find((s) => s.sectionId === "conclusion");
    expect(deck.title).toBe(CLEAN_PROBLEM);
    expect(deck.slides[0]!.subtitle).toContain(cyber.name);
    expect(intro?.bullets.some((b) => b.startsWith("Problématique posée : Comment une PME"))).toBe(true);
    expect(intro?.bullets.some((b) => b.startsWith("Termes de la problématique à définir : PME, protéger, rançongiciels"))).toBe(true);
    expect(problem?.bullets[0]).toBe(deck.title);
    expect(conclusion?.bullets[0]).toBe(`Répondre explicitement à : ${deck.title}`);
    expect(conclusion?.bullets).toContain("À compléter : la réponse explicite à la problématique (oui, non, à quelles conditions)");
  });

  it("devrait annoncer le sujet dans les notes de couverture et rappeler que la trame est sans IA", () => {
    const deck = buildFreeFinalDeck(program, cyber, PROBLEM);
    expect(deck.slides[0]!.notes).toContain(`annoncer le sujet « ${cyber.name} »`);
    expect(deck.slides[1]!.notes).toContain("Trame sans IA : remplacez chaque « À compléter »");
    expect(allText(deck)).not.toMatch(/thème/i);
  });

  it("devrait retomber sur le nom du sujet si la problématique est vide", () => {
    const deck = buildFreeFinalDeck(program, cyber, "   ");
    expect(deck.title).toBe(cyber.name);
    expectValid(deck, program.template);
  });

  it("devrait rédiger en anglais quand la trame est en anglais", () => {
    const ctx = { ...program, template: { ...defaultTemplate(), language: "en" as const } };
    const deck = buildFreeFinalDeck(ctx, cyber, PROBLEM);
    const text = allText(deck);
    expect(text).toContain("To complete:");
    expect(text).toContain("Subject leads:");
    expect(text).not.toContain("À compléter");
    expect(deck.slides[0]!.notes).toMatch(/Introduce yourself/);
  });

  it("devrait s'enchaîner avec la classification gratuite", () => {
    const { ranked, reformulatedProblem } = classifyProblemFree(program, PROBLEM);
    const theme = program.themes.find((t) => t.id === ranked[0]!.themeId);
    expect(theme?.id).toBe("cyber");
    expect(buildFreeFinalDeck(program, theme ?? cyber, reformulatedProblem).title).toBe(reformulatedProblem);
  });
});

describe("buildFreeFinalDeck — sans sujet", () => {
  const deck = buildFreeFinalDeck(program, null, PROBLEM);

  it("devrait mettre la problématique en titre et le nom du projet en sous-titre de couverture", () => {
    expect(deck.title).toBe(CLEAN_PROBLEM);
    expect(deck.slides[0]!.title).toBe(CLEAN_PROBLEM);
    expect(deck.slides[0]!.subtitle).toBe(program.name);
  });

  it("ne devrait ni cadre, ni pistes, ni notes de sujet", () => {
    const text = [allText(deck), ...deck.slides.map((s) => s.notes)].join("\n");
    expect(text).not.toContain("Cadre du sujet");
    expect(text).not.toContain("Pistes du sujet");
    expect(text).not.toContain("Vos notes");
    for (const theme of program.themes) expect(text).not.toContain(theme.name);
  });

  it("devrait annoncer la problématique (pas un sujet) dans les notes de couverture", () => {
    expect(deck.slides[0]!.notes).not.toMatch(/annoncer le sujet/);
    expect(deck.slides[0]!.notes).toMatch(/problématique/);
  });

  it("devrait retomber sur le nom du projet si la problématique est vide", () => {
    const empty = buildFreeFinalDeck(program, null, "  ");
    expect(empty.title).toBe(program.name);
    expectValid(empty, program.template);
  });
});

describe("buildFreeFinalDeck — notes du sujet", () => {
  /** Une seule diapo de développement « content » : tous les éléments de notes y arrivent. */
  const oneSlot: PromptTemplate = {
    ...defaultTemplate(),
    sections: [
      { id: "intro", title: "Introduction", guidance: "Contexte.", slides: 1 },
      { id: "analyse", title: "Analyse", guidance: "Causes et mécanismes.", slides: 1 },
      { id: "conclusion", title: "Conclusion", guidance: "Réponse.", slides: 1 },
    ],
  };
  const ctx = { ...program, template: oneSlot };

  it("devrait placer un élément de notes en puce d'une diapo de développement, en tête", () => {
    const deck = buildFreeFinalDeck(ctx, withNotes("Exemple : l'attaque de l'hôpital de Corbeil-Essonnes"), PROBLEM);
    const analyse = deck.slides.find((s) => s.sectionId === "analyse")!;
    expect(analyse.bullets[0]).toBe("Exemple : l'attaque de l'hôpital de Corbeil-Essonnes");
    expectValid(deck, oneSlot);
  });

  it("devrait répartir les éléments à tour de rôle sur les diapos de développement de la trame par défaut", () => {
    const deck = buildFreeFinalDeck(program, withNotes(NOTES_SAMPLE), PROBLEM);
    const items = splitSubjectNotes(NOTES_SAMPLE);
    const carriers = items.map((item) => deck.slides.findIndex((s) => s.bullets.includes(item)));
    expect(carriers.every((i) => i > 0)).toBe(true);
    expect(new Set(carriers).size).toBe(items.length);
    for (const i of carriers) expect(["part1", "part2", "part3"]).toContain(deck.slides[i]!.sectionId);
  });

  it("devrait mettre au plus 3 éléments en puces et le reste dans les notes d'orateur, préfixé « Vos notes : »", () => {
    const notes = ["Premier élément", "Deuxième élément", "Troisième élément", "Quatrième élément", "Cinquième élément"].join("\n");
    const deck = buildFreeFinalDeck(ctx, withNotes(notes), PROBLEM);
    const analyse = deck.slides.find((s) => s.sectionId === "analyse")!;
    expect(analyse.bullets.slice(0, 3)).toEqual(["Premier élément", "Deuxième élément", "Troisième élément"]);
    expect(analyse.bullets).not.toContain("Quatrième élément");
    expect(analyse.notes).toContain("Vos notes : Quatrième élément ; Cinquième élément");
    expectValid(deck, oneSlot);
  });

  it("ne devrait perdre aucun élément de notes (puce ou notes d'orateur)", () => {
    const notes = Array.from({ length: 12 }, (_, i) => `Élément ${i + 1} de mes notes`).join("\n");
    for (const [, template] of VARIED_TEMPLATES) {
      const deck = buildFreeFinalDeck({ ...program, template }, withNotes(notes), PROBLEM);
      const text = deck.slides.flatMap((s) => [...s.bullets, s.notes]).join("\n");
      for (const item of splitSubjectNotes(notes)) expect(text).toContain(item);
    }
  });

  it("devrait recopier les chiffres et sources des notes tels qu'écrits", () => {
    const deck = buildFreeFinalDeck(program, withNotes(NOTES_SAMPLE), PROBLEM);
    expect(allText(deck)).toContain("37 % des PME attaquées en 2023 (Cybermalveillance.gouv.fr, Rapport d'activité, 2024)");
  });
});

describe("buildFreeFinalDeck — rien d'inventé", () => {
  const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  /** Vocabulaire des libellés fixes de la langue (fonctions appelées avec des arguments vides). */
  function fixedVocabulary(lang: "fr" | "en"): Set<string> {
    const out = new Set<string>(["1", "2", "3"]);
    const visit = (value: unknown) => {
      if (typeof value === "string") for (const w of words(value)) out.add(w);
      else if (typeof value === "function") visit((value as (...args: unknown[]) => unknown)("", 0, false));
      else if (value && typeof value === "object") for (const v of Object.values(value)) visit(v);
    };
    visit(OUTLINE_TEXTS[lang]);
    return out;
  }

  function inputVocabulary(ctx: ProgramContext, subject: ThemeRef | null, problem: string): Set<string> {
    const texts = [
      ctx.name,
      problem,
      ...ctx.template.sections.flatMap((s) => [s.title, s.guidance]),
      ...(subject ? [subject.name, subject.description, ...subject.keywords, subject.notes] : []),
    ];
    return new Set(texts.flatMap(words));
  }

  it.each([
    ["avec sujet et notes", withNotes(NOTES_SAMPLE)],
    ["avec sujet sans notes", cyber],
    ["sans sujet", null],
  ] as const)("toute puce vient de la trame, du sujet, de la problématique ou d'un libellé fixe (%s)", (_, subject) => {
    for (const [, template] of VARIED_TEMPLATES) {
      const ctx = { ...program, template };
      const allowed = new Set([...inputVocabulary(ctx, subject, PROBLEM), ...fixedVocabulary(template.language)]);
      const deck = buildFreeFinalDeck(ctx, subject, PROBLEM);
      for (const bullet of deck.slides.flatMap((s) => s.bullets)) {
        // Une puce tronquée finit par un mot coupé : seul ce mot est écarté de la vérification.
        const whole = bullet.endsWith("…") ? bullet.slice(0, bullet.lastIndexOf(" ")) : bullet;
        const foreign = words(whole).filter((w) => !allowed.has(w));
        expect(foreign, bullet).toEqual([]);
      }
    }
  });
});

describe("buildFreeFinalDeck — minutage", () => {
  function ranges(deck: DeckSpec): Array<[number, number]> {
    return deck.slides.map((s) => {
      const m = /^\[(\d+):(\d{2})–(\d+):(\d{2})\] \S/.exec(s.notes);
      expect(m, s.notes).not.toBeNull();
      const [, a, b, c, d] = m ?? [];
      return [Number(a) * 60 + Number(b), Number(c) * 60 + Number(d)];
    });
  }

  it("devrait caler le minutage des notes sur la durée de l'oral, au format [m:ss–m:ss]", () => {
    const r = ranges(buildFreeFinalDeck(program, cyber, PROBLEM));
    expect(r[0]![0]).toBe(0);
    for (let i = 1; i < r.length; i++) expect(r[i]![0]).toBe(r[i - 1]![1]);
    expect(r[r.length - 1]![1]).toBe(program.template.durationMinutes * 60);
  });

  it("devrait suivre les durées fixées des lignes (templateTimings)", () => {
    const template = VARIED_TEMPLATES.find(([name]) => name === "avec durées fixées")![1];
    const deck = buildFreeFinalDeck({ ...program, template }, cyber, PROBLEM);
    const timings = templateTimings(template);
    const expected = [timings.cover, ...timings.slides].map((t) => `[${formatSeconds(t.start)}–${formatSeconds(t.end)}]`);
    expect(deck.slides.map((s) => s.notes.slice(0, s.notes.indexOf("]") + 1))).toEqual(expected);
    // La ligne « Premier axe » (3 diapos) dure 5 minutes.
    const part1 = deck.slides.filter((s) => s.sectionId === "part1");
    expect(part1[0]!.notes.startsWith(`[${formatSeconds(timings.sections[3]!.start)}–`)).toBe(true);
    expect(timings.sections[3]!.end - timings.sections[3]!.start).toBe(300);
  });
});

describe("splitSubjectNotes", () => {
  it.each([
    ["une ligne = un élément", "Premier\nSecond", ["Premier", "Second"]],
    ["puces retirées", "- a\n* b\n• c", ["a", "b", "c"]],
    ["numéros retirés", "1. un\n2) deux\n10. dix", ["un", "deux", "dix"]],
    ["lignes vides ignorées", "\n  \nA\n\n\nB\n", ["A", "B"]],
    ["année en tête conservée", "2022. Rapport de l'ADEME", ["2022. Rapport de l'ADEME"]],
    ["tiret intérieur conservé", "Coût - bénéfice", ["Coût - bénéfice"]],
    ["espaces et retours chariot", "  a  \r\n\tb\t", ["a", "b"]],
    ["vide", "", []],
  ] as const)("%s", (_, notes, expected) => {
    expect(splitSubjectNotes(notes)).toEqual(expected);
  });

  it("devrait garder 30 éléments au plus", () => {
    const notes = Array.from({ length: 31 }, (_, i) => `Élément ${i + 1}`).join("\n");
    const items = splitSubjectNotes(notes);
    expect(items).toHaveLength(30);
    expect(items[29]).toBe("Élément 30");
  });

  it("devrait tronquer chaque élément à la longueur d'une puce", () => {
    const [item] = splitSubjectNotes(`- ${"mot ".repeat(100)}`);
    expect(item!.length).toBeLessThanOrEqual(LIMITS.bullet);
    expect(item!.endsWith("…")).toBe(true);
  });
});

describe("lecture de la trame", () => {
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

  it("devrait reconnaître un contenu type qui oppose deux notions", () => {
    expect(twoColumnLabels({ title: "Bilan", guidance: "Enjeux et risques pour l'entreprise." })).toEqual(["Enjeux", "Risques"]);
    expect(twoColumnLabels({ title: "Analyse", guidance: "Avantages, inconvénients." })).toEqual(["Avantages", "Inconvénients"]);
    expect(twoColumnLabels({ title: "Analysis", guidance: "Benefits and risks." }, "en")).toEqual(["Benefits", "Risks"]);
    expect(twoColumnLabels({ title: "Analyse", guidance: "Causes et mécanismes." })).toBeNull();
    expect(twoColumnLabels({ title: "Comparaison des deux modèles", guidance: "" })).toEqual(["Premier terme", "Second terme"]);
    expect(twoColumnLabels({ title: "Comparison", guidance: "" }, "en")).toEqual(["First option", "Second option"]);
  });
});

describe("deck gratuit — couverture et intercalaires", () => {
  const theme: ThemeRef = { id: "g", name: "Green IT", description: "", keywords: [], notes: "" };
  const problem = "Le Green IT peut-il réellement réduire l'empreinte environnementale du numérique ?";

  it("ne devrait pas répéter le sujet dans le sous-titre quand le projet porte déjà son nom", () => {
    const deck = buildFreeFinalDeck(makeProgram({ name: "Green IT — Gratuit" }), theme, problem);
    expect(deck.slides[0]!.subtitle).toBe("Green IT — Gratuit");
  });

  it("devrait garder sujet et projet quand ils diffèrent", () => {
    const deck = buildFreeFinalDeck(makeProgram({ name: "Grand oral 2026" }), theme, problem);
    expect(deck.slides[0]!.subtitle).toBe("Green IT — Grand oral 2026");
  });

  it("devrait rendre une ligne « Intercalaire » d'une diapo en diapo de section", () => {
    const template = makeTemplate({
      sections: [
        { id: "intro", title: "Introduction", guidance: "", slides: 1 },
        { id: "inter-1", title: "Intercalaire Partie I", guidance: "Titre de partie + les diapos qu'elle contient", slides: 1 },
        { id: "p1", title: "Partie I — l'état des lieux", guidance: "Le constat mesuré", slides: 2 },
        { id: "conclusion", title: "Conclusion", guidance: "", slides: 1 },
      ],
    });
    const deck = buildFreeFinalDeck(makeProgram({ template }), theme, problem);
    expectValid(deck, template);
    expect(deck.slides[2]!.layout).toBe("section");
  });
});
