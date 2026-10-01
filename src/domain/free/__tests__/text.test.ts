import { describe, expect, it } from "vitest";
import { analyze, deaccent, extractTerms, normalizeText, stem, STOP_WORDS } from "@/domain/free/text";

function stemOf(word: string): string {
  return stem(deaccent(word.toLowerCase()));
}

describe("normalizeText", () => {
  it("devrait mettre en minuscules et remplacer la ponctuation par des espaces", () => {
    expect(normalizeText("Cloud, IA ; et RGPD !")).toBe("cloud ia et rgpd");
  });

  it("devrait retirer les élisions, apostrophe droite ou typographique", () => {
    expect(normalizeText("L'entreprise et l’intelligence qu'on d'abord")).toBe("entreprise et intelligence on abord");
  });

  it("devrait couper les mots composés au trait d'union", () => {
    expect(normalizeText("Peut-on co-construire ?")).toBe("peut on co construire");
  });

  it("devrait conserver les accents pour l'affichage", () => {
    expect(normalizeText("Écologie numérique")).toBe("écologie numérique");
  });
});

describe("deaccent", () => {
  it("devrait retirer les diacritiques et développer les ligatures", () => {
    expect(deaccent("écologie à cœur où ça")).toBe("ecologie a coeur ou ca");
  });
});

describe("stem", () => {
  it.each([
    ["numérique", "numériques"],
    ["transformation", "transformations"],
    ["transformation", "transformer"],
    ["écologique", "écologie"],
    ["sécurité", "sécuriser"],
    ["sécurisation", "sécurité"],
    ["management", "managers"],
    ["changement", "changer"],
    ["social", "sociaux"],
    ["sociale", "social"],
    ["agile", "agilité"],
    ["durable", "durabilité"],
    ["responsable", "responsabilité"],
    ["entrepreneur", "entrepreneuriat"],
    ["risque", "risques"],
    ["artificielle", "artificiel"],
    ["collaborative", "collaboratif"],
    ["organisation", "organiser"],
    ["données", "donnée"],
  ])("devrait rapprocher « %s » et « %s »", (a, b) => {
    expect(stemOf(a)).toBe(stemOf(b));
  });

  it.each([
    ["gestion", "gestion"],
    ["cloud", "cloud"],
    ["ia", "ia"],
    ["process", "process"],
  ])("devrait laisser « %s » intact (racine trop courte ou sans suffixe)", (word, expected) => {
    expect(stemOf(word)).toBe(expected);
  });

  it("ne devrait pas confondre des mots de familles différentes", () => {
    expect(stemOf("données")).not.toBe(stemOf("domaine"));
    expect(stemOf("cloud")).not.toBe(stemOf("climat"));
    expect(stemOf("éthique")).not.toBe(stemOf("étude"));
  });
});

describe("extractTerms", () => {
  it("devrait écarter les mots vides et les tournures interrogatives", () => {
    const terms = extractTerms("Dans quelle mesure peut-on dire que l'IA est-elle éthique ?");
    expect(terms.map((t) => t.surface)).toEqual(["dire", "IA", "éthique"]);
  });

  it("devrait garder la forme d'affichage accentuée et une racine sans accents", () => {
    expect(extractTerms("Sécurité")).toEqual([{ surface: "sécurité", stem: "secur" }]);
  });

  it("devrait garder les sigles en capitales et mettre les autres mots en minuscules", () => {
    expect(extractTerms("Le RGPD protège-t-il les PME ? Données").map((t) => t.surface)).toEqual(["RGPD", "protège", "PME", "données"]);
    expect(extractTerms("RGPD")[0].stem).toBe("rgpd");
  });

  it("devrait retirer une élision en capitales", () => {
    expect(extractTerms("L'IA D'ABORD").map((t) => t.surface)).toEqual(["IA", "ABORD"]);
  });

  it("devrait garder les années et écarter les petits nombres", () => {
    expect(extractTerms("Les 3 défis de 2030").map((t) => t.surface)).toEqual(["défis", "2030"]);
  });

  it("devrait renvoyer une liste vide pour un texte vide ou composé de mots vides", () => {
    expect(extractTerms("")).toEqual([]);
    expect(extractTerms("Comment et pourquoi ?")).toEqual([]);
  });
});

describe("STOP_WORDS", () => {
  it("devrait contenir une centaine de mots vides, sans accents", () => {
    expect(STOP_WORDS.size).toBeGreaterThanOrEqual(100);
    for (const word of STOP_WORDS) expect(word).toBe(deaccent(word));
  });
});

describe("analyze", () => {
  it("devrait produire des racines et des bigrammes par-dessus les mots vides", () => {
    const a = analyze("La gestion des risques");
    expect(a.unigrams).toEqual(["gestion", "risqu"]);
    expect(a.bigrams).toEqual(["gestion risqu"]);
  });

  it("devrait rapprocher deux formulations d'une même expression", () => {
    expect(analyze("gestion de risques").bigrams).toEqual(analyze("Gestion du risque").bigrams);
  });
});
