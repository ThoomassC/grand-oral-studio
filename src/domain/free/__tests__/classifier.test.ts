import { describe, expect, it } from "vitest";
import { classifyProblemFree, cleanProblem } from "@/domain/free/classifier";
import { makeProgram } from "@/test/fixtures";
import { LABELED_PROBLEMS, makeMasterProgram, makeMasterThemes } from "./master-program";

function evaluate(program = makeMasterProgram()) {
  const failuresTop1: string[] = [];
  const failuresTop3: string[] = [];
  for (const { problem, expected } of LABELED_PROBLEMS) {
    const ids = classifyProblemFree(program, problem).ranked.map((r) => r.themeId);
    if (ids[0] !== expected) failuresTop1.push(`${problem} → attendu ${expected}, obtenu ${ids.join(", ")}`);
    if (!ids.includes(expected)) failuresTop3.push(`${problem} → attendu ${expected}, obtenu ${ids.join(", ")}`);
  }
  return { failuresTop1, failuresTop3 };
}

describe("classifyProblemFree — jeu étiqueté", () => {
  it("devrait contenir au moins 20 problématiques couvrant les 9 thèmes", () => {
    expect(LABELED_PROBLEMS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(LABELED_PROBLEMS.map((p) => p.expected)).size).toBe(9);
  });

  it("devrait reconnaître le bon thème en tête pour au moins 85 % des problématiques", () => {
    const { failuresTop1 } = evaluate();
    const correct = LABELED_PROBLEMS.length - failuresTop1.length;
    expect(correct / LABELED_PROBLEMS.length, failuresTop1.join("\n")).toBeGreaterThanOrEqual(17 / 20);
  });

  /**
   * Échec connu et assumé : la problématique ne partage AUCUN mot (même
   * approché) avec le thème attendu ; seul un modèle sémantique peut la
   * rattacher. On ne retouche pas les données pour la faire passer : le test
   * fige ce périmètre pour détecter toute régression supplémentaire.
   */
  const KNOWN_TOP3_MISSES = ["Faut-il limiter le renouvellement des smartphones pour préserver les ressources de la planète ?"];

  it("devrait placer le bon thème dans le top 3 dès qu'un mot est en commun", () => {
    const misses = evaluate().failuresTop3.map((f) => f.split(" → ")[0]);
    expect(misses).toEqual(KNOWN_TOP3_MISSES);
  });

  it("devrait donner le même classement quel que soit l'ordre des thèmes", () => {
    const reversed = makeMasterProgram(makeMasterThemes().reverse());
    const rotated = makeMasterProgram([...makeMasterThemes().slice(4), ...makeMasterThemes().slice(0, 4)]);
    for (const { problem } of LABELED_PROBLEMS) {
      const reference = classifyProblemFree(makeMasterProgram(), problem);
      expect(classifyProblemFree(reversed, problem)).toEqual(reference);
      expect(classifyProblemFree(rotated, problem)).toEqual(reference);
    }
  });

  it("devrait être déterministe", () => {
    const problem = LABELED_PROBLEMS[0].problem;
    expect(classifyProblemFree(makeMasterProgram(), problem)).toEqual(classifyProblemFree(makeMasterProgram(), problem));
  });
});

describe("classifyProblemFree — confiance", () => {
  it("devrait rendre au plus 3 thèmes du programme, triés par confiance décroissante", () => {
    const program = makeMasterProgram();
    const ids = new Set(program.themes.map((t) => t.id));
    for (const { problem } of LABELED_PROBLEMS) {
      const { ranked } = classifyProblemFree(program, problem);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked.length).toBeLessThanOrEqual(3);
      for (const r of ranked) expect(ids.has(r.themeId)).toBe(true);
      const confidences = ranked.map((r) => r.confidence);
      expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    }
  });

  it("ne devrait jamais renvoyer une confiance de 1, même avec un seul thème", () => {
    const [only] = makeMasterThemes();
    const program = makeMasterProgram([only]);
    const { ranked } = classifyProblemFree(program, "Cybersécurité et gestion des risques : rançongiciel, phishing, piratage ?");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].confidence).toBeLessThan(1);
    expect(ranked[0].confidence).toBeGreaterThan(0.5);
  });

  it("devrait rester prudente (≤ 0,3) et le dire quand aucun mot n'est en commun", () => {
    const { ranked } = classifyProblemFree(makeMasterProgram(), "Faut-il interdire la corrida au nom du bien-être animal ?");
    expect(ranked.length).toBeGreaterThan(0);
    for (const r of ranked) {
      expect(r.confidence).toBeLessThanOrEqual(0.3);
      expect(r.rationale).toBe("Aucun mot-clé en commun : proposition par défaut, vérifiez le sujet.");
    }
  });

  it("devrait être nettement plus confiante sur une problématique explicite que sur une problématique vague", () => {
    const program = makeMasterProgram();
    const explicit = classifyProblemFree(program, "Comment se protéger des rançongiciels et du phishing grâce à la gestion des risques ?");
    const vague = classifyProblemFree(program, "Les entreprises doivent-elles changer ?");
    expect(explicit.ranked[0].themeId).toBe("cyber");
    expect(explicit.ranked[0].confidence).toBeGreaterThan(0.6);
    expect(vague.ranked[0].confidence).toBeLessThan(explicit.ranked[0].confidence);
  });
});

describe("classifyProblemFree — justification et thème annoncé", () => {
  it("devrait citer les mots en commun, sous leur forme accentuée", () => {
    const { ranked } = classifyProblemFree(makeMasterProgram(), "En quoi le télétravail transforme-t-il le fonctionnement des entreprises ?");
    expect(ranked[0].themeId).toBe("transfo");
    expect(ranked[0].rationale).toMatch(/^Mots en commun : .*télétravail/);
  });

  it("devrait signaler un mot-clé du thème retrouvé en entier", () => {
    const { ranked } = classifyProblemFree(makeMasterProgram(), "La gestion des risques suffit-elle face aux cyberattaques ?");
    expect(ranked[0].themeId).toBe("cyber");
    expect(ranked[0].rationale).toContain("gestion des risques");
    expect(ranked[0].rationale).toMatch(/du sujet retrouvé/);
    expect(ranked.map((r) => r.rationale).join(" ")).not.toMatch(/thème/);
  });

  it("devrait placer le thème annoncé en tête, avec sa propre justification, même s'il est loin", () => {
    const program = makeMasterProgram();
    const problem = "Comment une PME peut-elle se protéger efficacement contre les rançongiciels ?";
    const { ranked } = classifyProblemFree(program, problem, "agile");
    expect(ranked).toHaveLength(3);
    expect(ranked[0].themeId).toBe("agile");
    expect(ranked[0].rationale).not.toBe("Sujet annoncé avec la problématique.");
    expect(ranked.map((r) => r.themeId)).toContain("cyber");
  });

  it("devrait ignorer un thème annoncé inconnu du programme", () => {
    const program = makeMasterProgram();
    const problem = LABELED_PROBLEMS[0].problem;
    expect(classifyProblemFree(program, problem, "inconnu")).toEqual(classifyProblemFree(program, problem));
  });

  it("devrait renvoyer un classement vide pour un programme sans thème", () => {
    const result = classifyProblemFree(makeProgram({ themes: [] }), "comment faire ?");
    expect(result).toEqual({ reformulatedProblem: "Comment faire ?", ranked: [] });
  });
});

describe("cleanProblem", () => {
  it("devrait fusionner les espaces, mettre une majuscule et un point d'interrogation final", () => {
    expect(cleanProblem("  comment   protéger les données \n personnelles  ")).toBe("Comment protéger les données personnelles ?");
  });

  it("devrait reconnaître une question par inversion du sujet", () => {
    expect(cleanProblem("le télétravail transforme-t-il les entreprises.")).toBe("Le télétravail transforme-t-il les entreprises ?");
  });

  it("devrait normaliser un point d'interrogation déjà présent", () => {
    expect(cleanProblem("Faut-il payer la rançon?")).toBe("Faut-il payer la rançon ?");
  });

  it("ne devrait pas ajouter de point d'interrogation à une affirmation", () => {
    expect(cleanProblem("l'impact de l'IA sur l'emploi des cadres")).toBe("L'impact de l'IA sur l'emploi des cadres");
  });

  it("devrait retirer les caractères de contrôle et borner la longueur", () => {
    const long = `comment ${"très ".repeat(200)}loin ?`;
    const cleaned = cleanProblem(`\u0007${long}`);
    expect(cleaned.length).toBeLessThanOrEqual(600);
    expect(cleaned.startsWith("Comment")).toBe(true);
    expect(cleaned.endsWith(" ?")).toBe(true);
  });
});
