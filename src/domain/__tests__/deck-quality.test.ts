import { describe, expect, it } from "vitest";
import {
  assessFinalDeck,
  enforceProblem,
  finalDeckReview,
  findUnsourcedFigures,
  neutralizeSkeletonProblem,
  pickBetterDeck,
  qualityFeedback,
  qualityWarnings,
  skeletonStaleness,
  SKELETON_PROBLEM_PLACEHOLDER,
} from "@/domain/deck-quality";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { DeckSpecSchema, type DeckSpec, type PromptTemplate, type Slide } from "@/domain/schemas";
import { makeConformingDeck, makeTemplate } from "@/test/fixtures";
import { GREEN_IT_FINAL, GREEN_IT_PROBLEM, GREEN_IT_SKELETON, GREEN_IT_TEMPLATE } from "./green-it.fixture";

const PROGRAM = "Green IT v2 — Ollama";
const THEME = "Green IT";

function slide(partial: Pick<Slide, "layout" | "sectionId" | "title"> & Partial<Slide>): Slide {
  return { subtitle: "", bullets: [], notes: "", ...partial };
}

/** Deck conforme au gabarit Green IT, rédigé pour la problématique (aucune reprise du squelette). */
function goodGreenItDeck(): DeckSpec {
  const slides: Slide[] = [
    slide({
      layout: "title",
      sectionId: "cover",
      title: "Green IT : réduire ou compenser ?",
      notes: "[0:00–0:30] Bonjour. Je vais examiner si le Green IT réduit vraiment l'empreinte du numérique.",
    }),
  ];
  for (const section of GREEN_IT_TEMPLATE.sections) {
    for (let k = 0; k < section.slides; k += 1) {
      const conclusion = section.id === "conclusion";
      slides.push(
        slide({
          layout: conclusion ? "conclusion" : "content",
          sectionId: section.id,
          title: `${section.title} ${k + 1}`,
          bullets: [`Idée ${section.id} numéro ${k + 1}`, `Exemple concret ${k + 1} pour ${section.title}`],
          notes: conclusion
            ? "[19:00–19:40] Ma réponse est nuancée : le Green IT réduit réellement l'empreinte environnementale par usage, mais la croissance des usages compense ces gains, et il faut donc de la sobriété."
            : `[1:00–1:40] Sur ${section.title.toLowerCase()} étape ${k + 1}, je montre au jury un argument original numéro ${k + 1} qui éclaire la tension entre efficacité unitaire et volume total.`,
        }),
      );
    }
  }
  return DeckSpecSchema.parse({ title: "Green IT : réduire ou compenser ?", subtitle: "", slides });
}

describe("assessFinalDeck — deck réel du passage 2 (copie du squelette)", () => {
  const quality = assessFinalDeck(GREEN_IT_FINAL, {
    template: GREEN_IT_TEMPLATE,
    skeleton: GREEN_IT_SKELETON,
    problem: GREEN_IT_PROBLEM,
  });

  it("devrait mesurer un taux de recopie des notes proche de 100 %", () => {
    expect(quality.notesCopyRate).toBeGreaterThanOrEqual(0.9);
  });

  it("devrait mesurer un taux de recopie des puces élevé (le retrait de « [source à trouver] » ne compte pas comme réécriture)", () => {
    expect(quality.bulletsCopyRate).toBeGreaterThanOrEqual(0.8);
  });

  it("devrait lister les sections dont le nombre de diapos diffère du gabarit, avec leur titre", () => {
    expect(quality.sectionGaps).toEqual(
      expect.arrayContaining([
        { sectionId: "partie-i-l-etat-des-lieux", title: "Partie I — l'état des lieux", expected: 4, actual: 1 },
        { sectionId: "partie-ii-le-deplacement", title: "Partie II — le déplacement", expected: 5, actual: 1 },
        { sectionId: "partie-iii-les-fronts", title: "Partie III — les fronts", expected: 8, actual: 1 },
      ]),
    );
    expect(quality.sectionGaps).toHaveLength(3);
  });

  it("devrait constater que la conclusion ne répond pas à la problématique tirée", () => {
    expect(quality.problemAddressed).toBe(false);
  });

  it("devrait être hors seuil", () => {
    expect(quality.ok).toBe(false);
  });
});

describe("assessFinalDeck — deck conforme", () => {
  it("devrait être dans les seuils : structure exacte, rien de recopié, conclusion qui répond", () => {
    const quality = assessFinalDeck(goodGreenItDeck(), {
      template: GREEN_IT_TEMPLATE,
      skeleton: GREEN_IT_SKELETON,
      problem: GREEN_IT_PROBLEM,
    });
    expect(quality.sectionGaps).toEqual([]);
    expect(quality.notesCopyRate).toBe(0);
    expect(quality.bulletsCopyRate).toBe(0);
    expect(quality.problemAddressed).toBe(true);
    expect(quality.ok).toBe(true);
  });

  it("devrait juger hors sujet une conclusion qui ne reprend que les mots déjà présents dans le squelette (génération réelle)", () => {
    // Conclusion réellement produite par qwen2.5:14b : elle répond à la question inventée du squelette,
    // pas à « … ou ne fait-il que compenser la croissance des usages ? ».
    const deck = goodGreenItDeck();
    deck.slides = deck.slides.map((s) =>
      s.sectionId === "conclusion"
        ? {
            ...s,
            title: "Conclusion",
            bullets: ["Réponse à la problématique", "Réduction de l'empreinte carbone", "Maintien des avantages du numérique", "Chiffres de la diapo 4"],
            notes:
              "[18:42–19:21] La réponse à la problématique est que le Green IT peut réduire l'empreinte carbone du numérique tout en maintenant ses avantages. Les chiffres de la diapo 4 le confirment.",
          }
        : s,
    );
    const quality = assessFinalDeck(deck, { template: GREEN_IT_TEMPLATE, skeleton: GREEN_IT_SKELETON, problem: GREEN_IT_PROBLEM });
    expect(quality.problemAddressed).toBe(false);
    expect(quality.ok).toBe(false);
  });

  it("devrait compter les notes vides ou réduites à un minutage comme notes à réécrire", () => {
    const deck = goodGreenItDeck();
    deck.slides = deck.slides.map((s, i) => (i >= 2 && i <= 12 ? { ...s, notes: "[1:00–1:40]" } : s));
    const quality = assessFinalDeck(deck, { template: GREEN_IT_TEMPLATE, skeleton: null, problem: GREEN_IT_PROBLEM });
    expect(quality.notesToRewrite).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(quality.ok).toBe(false);
  });

  it("ne devrait pas compter une note quasi identique mais réécrite pour la problématique", () => {
    const skeleton = goodGreenItDeck();
    const deck = goodGreenItDeck();
    deck.slides = deck.slides.map((s, i) =>
      i === 5 ? { ...s, notes: "[3:00–3:40] Ici je confronte les gains d'efficacité unitaire à l'explosion du nombre de terminaux et de vidéos." } : s,
    );
    const quality = assessFinalDeck(deck, { template: GREEN_IT_TEMPLATE, skeleton, problem: GREEN_IT_PROBLEM });
    expect(quality.notesToRewrite).not.toContain(6);
  });
});

describe("qualityFeedback", () => {
  const quality = assessFinalDeck(GREEN_IT_FINAL, {
    template: GREEN_IT_TEMPLATE,
    skeleton: GREEN_IT_SKELETON,
    problem: GREEN_IT_PROBLEM,
  });
  const feedback = qualityFeedback(quality, GREEN_IT_TEMPLATE);

  it("devrait dire au modèle quelles sections doivent compter combien de diapos", () => {
    expect(feedback).toContain("« Partie III — les fronts » : 8 diapos (ta réponse en avait 1)");
    expect(feedback).toContain("31 diapos");
  });

  it("devrait demander de réécrire les notes recopiées pour la problématique", () => {
    expect(feedback).toMatch(/notes d'orateur.*réécri/i);
    expect(feedback).toMatch(/problématique/);
  });

  it("devrait demander une conclusion qui répond à la problématique", () => {
    expect(feedback).toMatch(/conclusion/i);
  });
});

describe("qualityWarnings", () => {
  it("devrait formuler des avertissements lisibles, sans identifiant technique de section", () => {
    const quality = assessFinalDeck(GREEN_IT_FINAL, {
      template: GREEN_IT_TEMPLATE,
      skeleton: GREEN_IT_SKELETON,
      problem: GREEN_IT_PROBLEM,
    });
    const warnings = qualityWarnings(quality);
    expect(warnings.some((w) => /recopi/.test(w) && /squelette/.test(w))).toBe(true);
    expect(warnings.some((w) => /conclusion/i.test(w) && /problématique/.test(w))).toBe(true);
    expect(warnings.join(" ")).not.toMatch(/partie-i|le-chiffre-d-accroche/);
  });

  it("ne devrait rien signaler pour un deck dans les seuils", () => {
    const quality = assessFinalDeck(goodGreenItDeck(), { template: GREEN_IT_TEMPLATE, skeleton: GREEN_IT_SKELETON, problem: GREEN_IT_PROBLEM });
    expect(qualityWarnings(quality)).toEqual([]);
  });
});

describe("pickBetterDeck", () => {
  it("devrait garder le meilleur des deux résultats", () => {
    const ctx = { template: GREEN_IT_TEMPLATE, skeleton: GREEN_IT_SKELETON, problem: GREEN_IT_PROBLEM };
    const bad = { deck: GREEN_IT_FINAL, quality: assessFinalDeck(GREEN_IT_FINAL, ctx) };
    const good = { deck: goodGreenItDeck(), quality: assessFinalDeck(goodGreenItDeck(), ctx) };
    expect(pickBetterDeck(bad, good)).toBe(good);
    expect(pickBetterDeck(good, bad)).toBe(good);
  });
});

describe("enforceProblem", () => {
  const names = { themeName: THEME, programName: PROGRAM };

  it("devrait écrire la problématique tirée sur la diapo « Problématique » à la place de la question inventée", () => {
    const out = enforceProblem(GREEN_IT_FINAL, { template: GREEN_IT_TEMPLATE, problem: GREEN_IT_PROBLEM, ...names });
    const problemSlide = out.slides.find((s) => s.sectionId === "problematique")!;
    const text = [problemSlide.title, problemSlide.subtitle, ...problemSlide.bullets, problemSlide.notes].join("\n");
    expect(text).toContain(GREEN_IT_PROBLEM);
    expect(text).not.toContain("sans compromettre ses avantages");
    expect(problemSlide.notes.startsWith("[3:45–4:24]")).toBe(true);
    expect(() => DeckSpecSchema.parse(out)).not.toThrow();
  });

  it("devrait mettre la problématique en sous-titre de couverture et le titre du sujet à la place du nom du projet", () => {
    const out = enforceProblem(GREEN_IT_FINAL, { template: GREEN_IT_TEMPLATE, problem: GREEN_IT_PROBLEM, ...names });
    const cover = out.slides[0]!;
    expect(cover.title).toBe(THEME);
    expect(cover.subtitle).toBe(GREEN_IT_PROBLEM);
    expect(out.title).toBe(THEME);
    expect(out.subtitle).toBe(GREEN_IT_PROBLEM);
  });

  it("devrait garder un titre de couverture propre au deck", () => {
    const deck = goodGreenItDeck();
    const out = enforceProblem(deck, { template: GREEN_IT_TEMPLATE, problem: GREEN_IT_PROBLEM, ...names });
    expect(out.slides[0]!.title).toBe("Green IT : réduire ou compenser ?");
    expect(out.title).toBe("Green IT : réduire ou compenser ?");
  });

  it("devrait borner une problématique très longue aux limites du schéma", () => {
    const long = `${"Dans quelle mesure ".repeat(30)}le numérique peut-il devenir sobre ?`;
    const out = enforceProblem(GREEN_IT_FINAL, { template: GREEN_IT_TEMPLATE, problem: long, ...names });
    expect(() => DeckSpecSchema.parse(out)).not.toThrow();
    expect(out.slides.find((s) => s.sectionId === "problematique")!.notes).toContain(long);
  });

  it("devrait laisser intact un gabarit sans section problématique (hors couverture)", () => {
    const template: PromptTemplate = makeTemplate({
      sections: makeTemplate().sections.filter((s) => s.id !== "problem"),
    });
    const deck = makeConformingDeck();
    deck.slides = deck.slides.filter((s) => s.sectionId !== "problem");
    const out = enforceProblem(deck, { template, problem: GREEN_IT_PROBLEM, themeName: "Mobilités", programName: "Programme" });
    expect(out.slides.slice(1)).toEqual(deck.slides.slice(1));
    expect(out.slides[0]!.subtitle).toBe(GREEN_IT_PROBLEM);
  });
});

describe("neutralizeSkeletonProblem", () => {
  const names = { themeName: THEME, programName: PROGRAM };

  it("devrait retirer la question inventée de la section problématique du squelette", () => {
    const out = neutralizeSkeletonProblem(GREEN_IT_SKELETON, GREEN_IT_TEMPLATE, names);
    const problemSlide = out.slides.find((s) => s.sectionId === "problematique")!;
    const text = [problemSlide.title, problemSlide.subtitle, ...problemSlide.bullets, problemSlide.notes].join("\n");
    expect(text).not.toContain("Comment réduire l'empreinte carbone");
    expect(text).toContain(SKELETON_PROBLEM_PLACEHOLDER);
    expect(problemSlide.notes.startsWith("[3:45–4:24]")).toBe(true);
  });

  it("devrait remplacer le nom du projet en titre de couverture par le titre du sujet", () => {
    const out = neutralizeSkeletonProblem(GREEN_IT_SKELETON, GREEN_IT_TEMPLATE, names);
    expect(out.slides[0]!.title).toBe(THEME);
    expect(out.title).toBe(THEME);
  });

  it("ne devrait pas toucher aux autres sections", () => {
    const out = neutralizeSkeletonProblem(GREEN_IT_SKELETON, GREEN_IT_TEMPLATE, names);
    const others = (d: DeckSpec) => d.slides.slice(1).filter((s) => s.sectionId !== "problematique");
    expect(others(out)).toEqual(others(GREEN_IT_SKELETON));
  });
});

describe("findUnsourcedFigures", () => {
  it("devrait signaler les diapos qui affichent un chiffre sans source ni marqueur", () => {
    expect(findUnsourcedFigures(GREEN_IT_FINAL)).toEqual([
      { slide: 4, title: "Le chiffre d'accroche" },
      { slide: 16, title: "Conclusion" },
    ]);
  });

  it("ne devrait rien signaler quand le chiffre porte sa source ou le marqueur « [source à trouver] »", () => {
    expect(findUnsourcedFigures(GREEN_IT_SKELETON)).toEqual([]);
    const deck = makeConformingDeck();
    deck.slides[3] = { ...deck.slides[3]!, bullets: ["30 % des émissions", "Source : ADEME, Bilan, 2022"] };
    expect(findUnsourcedFigures(deck)).toEqual([]);
  });

  it("ne devrait pas prendre une numérotation (« 01 - … », « Front 1 ») pour un chiffre", () => {
    const deck = makeConformingDeck();
    deck.slides[3] = { ...deck.slides[3]!, bullets: ["01 - Réduction", "Front 2 : recyclage"] };
    expect(findUnsourcedFigures(deck)).toEqual([]);
  });

  it("devrait reconnaître une quantité avec unité", () => {
    const deck = makeConformingDeck();
    deck.slides[3] = { ...deck.slides[3]!, bullets: ["Les data centers consomment 200 TWh par an"] };
    expect(findUnsourcedFigures(deck)).toEqual([{ slide: 4, title: deck.slides[3]!.title }]);
  });
});

describe("skeletonStaleness", () => {
  it("devrait signaler à régénérer un squelette qui ne suit plus le gabarit actuel", () => {
    expect(skeletonStaleness(GREEN_IT_SKELETON, GREEN_IT_TEMPLATE)).toEqual({
      stale: true,
      reason: "Ne suit plus le gabarit actuel : 17 diapos au lieu de 31.",
    });
  });

  it("devrait signaler un squelette au bon total mais aux sections différentes", () => {
    const deck = makeConformingDeck();
    deck.slides[2] = { ...deck.slides[2]!, sectionId: "autre" };
    const result = skeletonStaleness(deck, makeTemplate());
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/sections/);
  });

  it("devrait considérer à jour un squelette conforme", () => {
    expect(skeletonStaleness(makeConformingDeck(), makeTemplate())).toEqual({ stale: false, reason: null });
  });
});

describe("checkDeckAgainstTemplate — libellés", () => {
  it("devrait citer le titre de la section, pas son identifiant", () => {
    const warnings = checkDeckAgainstTemplate(GREEN_IT_FINAL, GREEN_IT_TEMPLATE);
    expect(warnings).toContain("La section « Partie I — l'état des lieux » compte 1 diapo(s) au lieu de 4.");
    expect(warnings.join(" ")).not.toContain("partie-i-l-etat-des-lieux");
  });
});

describe("finalDeckReview — avertissements affichés à la relecture du deck final", () => {
  it("devrait signaler, en clair, les sections incomplètes, la recopie, la conclusion et les chiffres sans source", () => {
    const warnings = finalDeckReview(GREEN_IT_FINAL, { template: GREEN_IT_TEMPLATE, skeleton: GREEN_IT_SKELETON, problem: GREEN_IT_PROBLEM });
    expect(warnings).toContain("La section « Partie III — les fronts » compte 1 diapo(s) au lieu de 8.");
    expect(warnings.some((w) => /recopiées du squelette/.test(w))).toBe(true);
    expect(warnings.some((w) => /conclusion/i.test(w))).toBe(true);
    expect(warnings.some((w) => /Chiffre sans source/.test(w) && w.includes("« Le chiffre d'accroche »"))).toBe(true);
    expect(warnings.join(" ")).not.toMatch(/partie-iii-les-fronts/);
  });

  it("ne devrait rien signaler pour un deck conforme", () => {
    expect(finalDeckReview(goodGreenItDeck(), { template: GREEN_IT_TEMPLATE, skeleton: GREEN_IT_SKELETON, problem: GREEN_IT_PROBLEM })).toEqual([]);
  });
});

