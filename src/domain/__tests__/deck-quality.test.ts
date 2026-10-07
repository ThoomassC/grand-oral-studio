import { describe, expect, it } from "vitest";
import {
  assessFinalDeck,
  enforceProblem,
  finalDeckReview,
  finalDeckReviewItems,
  findUnsourcedFigures,
  pickBetterDeck,
  qualityFeedback,
  qualityWarnings,
} from "@/domain/deck-quality";
import { checkDeckAgainstTemplate } from "@/domain/deck";
import { DeckSpecSchema, type DeckSpec, type PromptTemplate, type Slide } from "@/domain/schemas";
import { makeConformingDeck, makeTemplate } from "@/test/fixtures";
import { GREEN_IT_FINAL, GREEN_IT_PROBLEM, GREEN_IT_SKELETON, GREEN_IT_TEMPLATE } from "./green-it.fixture";

const PROGRAM = "Green IT v2 — Ollama";
const THEME = "Green IT";
const CTX = { template: GREEN_IT_TEMPLATE, problem: GREEN_IT_PROBLEM };

function slide(partial: Pick<Slide, "layout" | "sectionId" | "title"> & Partial<Slide>): Slide {
  return { subtitle: "", bullets: [], notes: "", ...partial };
}

/** Deck conforme à la trame Green IT, rédigé pour la problématique (aucune reprise du contenu type). */
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

/** Le contenu type de chaque ligne recopié tel quel en notes et en puces (ce qu'un modèle local fait parfois). */
function copiedGuidanceDeck(): DeckSpec {
  const deck = goodGreenItDeck();
  const guidance = new Map(GREEN_IT_TEMPLATE.sections.map((s) => [s.id, s.guidance]));
  deck.slides = deck.slides.map((s, i) => {
    const text = guidance.get(s.sectionId);
    if (i === 0 || !text || s.sectionId === "conclusion") return s;
    return { ...s, notes: `[1:00–1:40] ${text}.`, bullets: text.split(/[.:]\s+/).filter(Boolean) };
  });
  return deck;
}

describe("assessFinalDeck — deck réel du passage 2 (structure et conclusion ratées)", () => {
  const quality = assessFinalDeck(GREEN_IT_FINAL, CTX);

  it("devrait lister les sections dont le nombre de diapos diffère de la trame, avec leur titre", () => {
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

describe("assessFinalDeck — recopie du contenu type de la trame", () => {
  it("devrait être dans les seuils pour un deck rédigé : structure exacte, rien de recopié, conclusion qui répond", () => {
    const quality = assessFinalDeck(goodGreenItDeck(), CTX);
    expect(quality.sectionGaps).toEqual([]);
    expect(quality.copiedNotes).toEqual([]);
    expect(quality.copiedBullets).toEqual([]);
    expect(quality.notesCopyRate).toBe(0);
    expect(quality.bulletsCopyRate).toBe(0);
    expect(quality.problemAddressed).toBe(true);
    expect(quality.ok).toBe(true);
  });

  it("devrait compter une note qui recopie le contenu type de SA ligne comme note à réécrire", () => {
    const deck = goodGreenItDeck();
    // Diapo 9 : première diapo de « Partie I — l'état des lieux ».
    const index = deck.slides.findIndex((s) => s.sectionId === "partie-i-l-etat-des-lieux");
    deck.slides[index] = {
      ...deck.slides[index]!,
      notes: "[4:00–4:40] Le constat mesuré. Se termine par un paradoxe ou une contradiction dans les données.",
    };
    const quality = assessFinalDeck(deck, CTX);
    expect(quality.copiedNotes).toEqual([index + 1]);
    expect(quality.notesToRewrite).toContain(index + 1);
  });

  it("ne devrait pas compter le contenu type d'une AUTRE ligne (la référence est la ligne de la diapo)", () => {
    const deck = goodGreenItDeck();
    const index = deck.slides.findIndex((s) => s.sectionId === "partie-ii-le-deplacement");
    deck.slides[index] = {
      ...deck.slides[index]!,
      notes: "[6:00–6:40] Le constat mesuré. Se termine par un paradoxe ou une contradiction dans les données.",
    };
    expect(assessFinalDeck(deck, CTX).copiedNotes).toEqual([]);
  });

  it("devrait compter des puces qui recopient le contenu type de la ligne", () => {
    const deck = goodGreenItDeck();
    const index = deck.slides.findIndex((s) => s.sectionId === "partie-ii-le-deplacement");
    deck.slides[index] = {
      ...deck.slides[index]!,
      bullets: ["Ce que le phénomène déplace", "La valeur, les compétences, les rôles", "L'entrée dans le métier"],
    };
    expect(assessFinalDeck(deck, CTX).copiedBullets).toEqual([index + 1]);
  });

  it("ne devrait pas compter une note réécrite pour la problématique qui reprend quelques mots du contenu type", () => {
    const deck = goodGreenItDeck();
    const index = deck.slides.findIndex((s) => s.sectionId === "partie-i-l-etat-des-lieux");
    deck.slides[index] = {
      ...deck.slides[index]!,
      notes: "[4:00–4:40] Le constat est mesuré : les gains d'efficacité unitaire sont réels, mais le nombre de terminaux et de vidéos explose.",
    };
    expect(assessFinalDeck(deck, CTX).copiedNotes).toEqual([]);
  });

  it("devrait mettre hors seuil un deck qui recopie le contenu type partout", () => {
    const quality = assessFinalDeck(copiedGuidanceDeck(), CTX);
    expect(quality.notesToRewriteRate).toBeGreaterThan(0.25);
    expect(quality.bulletsCopyRate).toBeGreaterThan(0.5);
    expect(quality.ok).toBe(false);
  });

  it("devrait compter les notes vides ou réduites à un minutage comme notes à réécrire", () => {
    const deck = goodGreenItDeck();
    deck.slides = deck.slides.map((s, i) => (i >= 2 && i <= 12 ? { ...s, notes: "[1:00–1:40]" } : s));
    const quality = assessFinalDeck(deck, CTX);
    expect(quality.notesToRewrite).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(quality.ok).toBe(false);
  });
});

describe("assessFinalDeck — conclusion et problématique", () => {
  it("devrait juger hors sujet une conclusion qui ne reprend que les mots de la trame", () => {
    const deck = goodGreenItDeck();
    deck.slides = deck.slides.map((s) =>
      s.sectionId === "conclusion"
        ? {
            ...s,
            title: "Conclusion",
            bullets: ["Réponse frontale à la problématique", "Reprise des chiffres de la diapo 4"],
            notes: "[18:42–19:21] Voici ma réponse frontale à la problématique, qui reprend les chiffres de la diapo 4 et la question laissée ouverte.",
          }
        : s,
    );
    const quality = assessFinalDeck(deck, CTX);
    expect(quality.problemAddressed).toBe(false);
    expect(quality.ok).toBe(false);
  });

  it("devrait accepter une conclusion qui reprend les termes propres de la problématique", () => {
    expect(assessFinalDeck(goodGreenItDeck(), CTX).problemAddressed).toBe(true);
  });
});

describe("qualityFeedback", () => {
  it("devrait dire au modèle quelles sections doivent compter combien de diapos", () => {
    const feedback = qualityFeedback(assessFinalDeck(GREEN_IT_FINAL, CTX), GREEN_IT_TEMPLATE);
    expect(feedback).toContain("« Partie III — les fronts » : 8 diapos (ta réponse en avait 1)");
    expect(feedback).toContain("31 diapos");
    expect(feedback).toMatch(/trame/);
    expect(feedback).not.toMatch(/gabarit|squelette/);
  });

  it("devrait demander de réécrire les notes recopiées du contenu type pour la problématique", () => {
    const feedback = qualityFeedback(assessFinalDeck(copiedGuidanceDeck(), CTX), GREEN_IT_TEMPLATE);
    expect(feedback).toMatch(/notes d'orateur recopiées du contenu type de la trame/i);
    expect(feedback).toMatch(/réécri/);
    expect(feedback).toMatch(/puces recopiées du contenu type/i);
    expect(feedback).not.toMatch(/squelette/);
  });

  it("devrait demander une conclusion qui répond à la problématique", () => {
    expect(qualityFeedback(assessFinalDeck(GREEN_IT_FINAL, CTX), GREEN_IT_TEMPLATE)).toMatch(/conclusion/i);
  });

  it("devrait le dire en anglais pour une trame anglaise, sans parler de squelette", () => {
    const template = { ...GREEN_IT_TEMPLATE, language: "en" as const };
    const feedback = qualityFeedback(assessFinalDeck(copiedGuidanceDeck(), { template, problem: GREEN_IT_PROBLEM }), template);
    expect(feedback).toMatch(/outline/);
    expect(feedback).not.toMatch(/skeleton/i);
  });
});

describe("qualityWarnings", () => {
  it("devrait formuler des avertissements lisibles, sans identifiant technique de section", () => {
    const warnings = qualityWarnings(assessFinalDeck(copiedGuidanceDeck(), CTX));
    expect(warnings.some((w) => /recopiées du contenu type de la trame/.test(w))).toBe(true);
    expect(warnings.some((w) => /reprises telles quelles du contenu type de la trame/.test(w))).toBe(true);
    expect(warnings.join(" ")).not.toMatch(/partie-i|le-chiffre-d-accroche|squelette/);
  });

  it("devrait signaler la conclusion hors problématique", () => {
    const warnings = qualityWarnings(assessFinalDeck(GREEN_IT_FINAL, CTX));
    expect(warnings.some((w) => /conclusion/i.test(w) && /problématique/.test(w))).toBe(true);
  });

  it("ne devrait rien signaler pour un deck dans les seuils", () => {
    expect(qualityWarnings(assessFinalDeck(goodGreenItDeck(), CTX))).toEqual([]);
  });
});

describe("pickBetterDeck", () => {
  it("devrait garder le meilleur des deux résultats", () => {
    const bad = { deck: GREEN_IT_FINAL, quality: assessFinalDeck(GREEN_IT_FINAL, CTX) };
    const good = { deck: goodGreenItDeck(), quality: assessFinalDeck(goodGreenItDeck(), CTX) };
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

  it("devrait, sans sujet, mettre la problématique en titre de couverture quand le modèle a mis le nom du projet", () => {
    const out = enforceProblem(GREEN_IT_FINAL, { template: GREEN_IT_TEMPLATE, problem: GREEN_IT_PROBLEM, themeName: null, programName: PROGRAM });
    expect(out.slides[0]!.title).toBe(GREEN_IT_PROBLEM);
    expect(out.title).toBe(GREEN_IT_PROBLEM);
    expect(out.slides[0]!.subtitle).toBe(GREEN_IT_PROBLEM);
    expect(() => DeckSpecSchema.parse(out)).not.toThrow();
  });

  it("devrait, sans sujet, garder un titre de couverture propre au deck", () => {
    const out = enforceProblem(goodGreenItDeck(), { template: GREEN_IT_TEMPLATE, problem: GREEN_IT_PROBLEM, themeName: null, programName: PROGRAM });
    expect(out.slides[0]!.title).toBe("Green IT : réduire ou compenser ?");
  });

  it("devrait laisser intacte une trame sans section problématique (hors couverture)", () => {
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

describe("checkDeckAgainstTemplate — libellés", () => {
  it("devrait citer le titre de la section, pas son identifiant", () => {
    const warnings = checkDeckAgainstTemplate(GREEN_IT_FINAL, GREEN_IT_TEMPLATE);
    expect(warnings).toContain("La section « Partie I — l'état des lieux » compte 1 diapo(s) au lieu de 4.");
    expect(warnings.join(" ")).not.toContain("partie-i-l-etat-des-lieux");
  });
});

describe("finalDeckReview — avertissements affichés à la relecture du deck final", () => {
  it("devrait signaler, en clair, les sections incomplètes, la conclusion et les chiffres sans source", () => {
    const warnings = finalDeckReview(GREEN_IT_FINAL, CTX);
    expect(warnings).toContain("La section « Partie III — les fronts » compte 1 diapo(s) au lieu de 8.");
    expect(warnings.some((w) => /conclusion/i.test(w))).toBe(true);
    expect(warnings.some((w) => /Chiffre sans source/.test(w) && w.includes("« Le chiffre d'accroche »"))).toBe(true);
    expect(warnings.join(" ")).not.toMatch(/partie-iii-les-fronts/);
  });

  it("devrait signaler la recopie du contenu type de la trame", () => {
    expect(finalDeckReview(copiedGuidanceDeck(), CTX).some((w) => /recopiées du contenu type de la trame/.test(w))).toBe(true);
  });

  it("ne devrait rien signaler pour un deck conforme", () => {
    expect(finalDeckReview(goodGreenItDeck(), CTX)).toEqual([]);
  });
});

describe("finalDeckReviewItems — avertissements reliés à leurs diapos", () => {
  const ctx = { template: makeTemplate(), problem: "Comment concilier mobilité et sobriété en ville" };
  /** Notes d'orateur rédigées (plus de huit mots) : aucune alerte « notes à réécrire ». */
  const spoken = (deck: DeckSpec): DeckSpec => ({
    ...deck,
    slides: deck.slides.map((s, i) => ({
      ...s,
      notes: `[0:${String(i).padStart(2, "0")}] Je développe ici une idée propre à la diapo numéro ${i + 1}, pour la mobilité et la sobriété en ville.`,
    })),
  });

  it("devrait renvoyer les mêmes messages que finalDeckReview, dans le même ordre", () => {
    const items = finalDeckReviewItems(GREEN_IT_FINAL, CTX);
    expect(items.map((i) => i.message)).toEqual(finalDeckReview(GREEN_IT_FINAL, CTX));
  });

  it("devrait relier une section au mauvais nombre de diapos aux diapos de cette section", () => {
    const deck = spoken(makeConformingDeck());
    deck.slides = deck.slides.filter((_, i) => i !== 7); // une diapo du second axe en moins (diapos 6 à 8)
    const items = finalDeckReviewItems(deck, ctx);
    expect(items).toContainEqual({ message: "La section « Second axe » compte 2 diapo(s) au lieu de 3.", slides: [6, 7] });
  });

  it("devrait relier une section absente à aucune diapo", () => {
    const deck = spoken(makeConformingDeck());
    deck.slides = deck.slides.filter((s) => s.sectionId !== "problem");
    expect(finalDeckReviewItems(deck, ctx)).toContainEqual({ message: "La section « Problématique » est absente du deck.", slides: [] });
  });

  it("devrait relier un chiffre sans source à sa diapo", () => {
    const deck = spoken(makeConformingDeck());
    deck.slides[3] = { ...deck.slides[3]!, bullets: ["La voiture pèse 63 % des trajets"] };
    const item = finalDeckReviewItems(deck, ctx).find((i) => i.message.startsWith("Chiffre sans source"));
    expect(item?.slides).toEqual([4]);
  });

  it("devrait relier les notes trop courtes aux diapos à réécrire", () => {
    const deck = makeConformingDeck(); // notes de consigne : « Partir d'une situation vécue. »
    const item = finalDeckReviewItems(deck, ctx).find((i) => i.message.startsWith("Notes d'orateur"));
    expect(item?.slides).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("devrait relier une conclusion hors problématique aux diapos de conclusion", () => {
    const deck = spoken(makeConformingDeck());
    deck.slides[8] = { ...deck.slides[8]!, title: "Merci", bullets: ["Questions"], notes: "[19:00] Merci pour votre attention, je suis prêt à répondre à vos questions maintenant." };
    const item = finalDeckReviewItems(deck, { ...ctx, problem: "Faut-il taxer le kérosène des avions long-courriers" }).find((i) =>
      i.message.startsWith("La conclusion"),
    );
    expect(item?.slides).toEqual([9]);
  });

  it("ne devrait rien renvoyer pour un deck conforme", () => {
    expect(finalDeckReviewItems(goodGreenItDeck(), CTX)).toEqual([]);
  });
});
