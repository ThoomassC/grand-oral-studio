import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import { normalizeTone, parseTemplateText } from "@/domain/import/template-from-text";
import { LIMITS, PromptTemplateSchema } from "@/domain/schemas";
import { templateTimings, totalSlides } from "@/domain/slides";

/**
 * Prompts Markdown structurés (cas réel : « Générer un deck d'oral dans Canva »,
 * tableau d'architecture de 31 diapos, règles de contenu, bloc d'entrées à remplir).
 */

const base = defaultTemplate();
const canva = readFileSync(join(__dirname, "prompt-oral-canva.fixture.md"), "utf8");

function parse(text: string) {
  const r = parseTemplateText(text, base);
  expect(PromptTemplateSchema.safeParse(r.template).success).toBe(true);
  return r;
}

describe("parseTemplateText — tableau Markdown de diapos", () => {
  it("devrait lire chaque ligne du tableau comme une section, avec son rôle comme consigne", () => {
    const r = parse(
      [
        "| # | Diapo | Rôle |",
        "|---|---|---|",
        "| 1 | **Accroche** | Un chiffre qui crée la tension |",
        "| 2-4 | **Partie I — le constat** | Le constat mesuré |",
        "| 5 | *Intercalaire* | |",
        "| 6 | **Conclusion** | Réponse frontale |",
      ].join("\n"),
    );
    expect(r.template.sections.map((s) => [s.title, s.slides, s.guidance])).toEqual([
      ["Accroche", 1, "Un chiffre qui crée la tension"],
      ["Partie I — le constat", 3, "Le constat mesuré"],
      ["Intercalaire", 1, ""],
      ["Conclusion", 1, "Réponse frontale"],
    ]);
    expect(r.recognized).toContain("sections");
  });

  it("ne devrait pas prendre pour des diapos un tableau sans colonne de numéros", () => {
    const r = parse(["| Logique | Figure |", "|---|---|", "| A recule | Opposition |", "| étapes | Frise |"].join("\n"));
    expect(r.template.sections).toEqual(base.sections);
    expect(r.recognized).not.toContain("sections");
  });

  it("devrait écarter une ligne « Couverture » (déjà ajoutée par l'application) et le signaler", () => {
    const r = parse(
      ["| # | Diapo | Rôle |", "|---|---|---|", "| 1 | **Couverture** | Titre + sous-titre |", "| 2 | Plan | Les parties |", "| 3 | Conclusion | Réponse |"].join("\n"),
    );
    expect(r.template.sections.map((s) => s.title)).toEqual(["Plan", "Conclusion"]);
    expect(r.warnings.some((w) => /Couverture/.test(w) && /ajout/.test(w))).toBe(true);
    // La consigne de couverture n'est pas perdue.
    expect(r.template.constraints).toMatch(/Couverture : Titre \+ sous-titre/);
  });
});

describe("parseTemplateText — prompt réel « deck d'oral dans Canva »", () => {
  const r = parse(canva);
  const titles = r.template.sections.map((s) => s.title);

  it("devrait produire les 31 diapos de l'architecture (couverture comprise)", () => {
    expect(totalSlides(r.template)).toBe(31);
    expect(r.template.sections).toHaveLength(16);
  });

  it("devrait garder la fin du plan : Réponses, Conclusion, Ouverture", () => {
    expect(titles.slice(-3)).toEqual(["Les réponses", "Conclusion", "Ouverture"]);
    expect(titles[0]).toBe("Présentation");
  });

  it("devrait convertir les plages « 9-12 » en nombre de diapos", () => {
    const slides = Object.fromEntries(r.template.sections.map((s) => [s.title, s.slides]));
    expect(slides["Partie I — l'état des lieux"]).toBe(4);
    expect(slides["Partie II — le déplacement"]).toBe(5);
    expect(slides["Partie III — les fronts"]).toBe(8);
  });

  it("ne devrait pas créer de section pour le titre du document, les entrées à remplir ou la mission", () => {
    expect(titles.join(" | ")).not.toMatch(/Générer un deck|Entrées|Ta mission|Architecture narrative|Règles de contenu/);
  });

  it("ne devrait laisser aucune syntaxe Markdown dans les titres, consignes et contraintes", () => {
    const texts = [...r.template.sections.flatMap((s) => [s.title, s.guidance]), r.template.constraints];
    for (const t of texts) expect(t).not.toMatch(/\*\*|`|^#{1,6}\s|\|\s*---|^---$/m);
  });

  it("devrait reprendre les règles de contenu dans les contraintes", () => {
    const c = r.template.constraints;
    expect(c).toMatch(/Un chiffre par diapo, jamais trois/);
    expect(c).toMatch(/12 mots/);
    expect(c).toMatch(/Ne fabrique aucun chiffre/);
    expect(c).toMatch(/Objection probable/);
    expect(c.length).toBeLessThanOrEqual(2000);
    // Les entrées à remplir n'y sont pas.
    expect(c).not.toMatch(/THÈME\s*:\s*…/);
  });

  it("devrait signaler les blocs du prompt non repris dans les contraintes (limite de 2 000 caractères)", () => {
    expect(r.warnings.some((w) => /non repris/.test(w) && /API Canva/.test(w))).toBe(true);
  });

  it("devrait reconnaître le format 1920×1080 comme 16:9 et ne pas inventer de durée", () => {
    expect(r.recognized).toContain("format");
    expect(r.template.format).toBe("16:9");
    expect(r.recognized).not.toContain("durationMinutes");
    expect(r.found.some((f) => f.startsWith("Durée"))).toBe(false);
    expect(r.warnings.some((w) => /durée/i.test(w) && /20 min/.test(w))).toBe(true);
  });

  it("devrait consigner la consigne de la couverture plutôt qu'une section Couverture", () => {
    expect(titles).not.toContain("Couverture");
    expect(r.template.constraints).toMatch(/Couverture : Titre du sujet/);
  });
});

describe("parseTemplateText — titres numérotés « ## 1. … »", () => {
  it("ne devrait pas couper un titre Markdown numéroté", () => {
    const r = parse("## 1. Introduction\nPoser le sujet.\n## 2. Développement\nArguments.\n## 3. Conclusion\nRépondre.");
    expect(r.template.sections.map((s) => s.title)).toEqual(["Introduction", "Développement", "Conclusion"]);
  });

  it("ne devrait pas prendre le titre du document ni un bloc d'entrées pour des sections", () => {
    const r = parse(
      ["# Mon oral", "## Entrées (à remplir)", "- **THÈME** : …", "## Introduction", "Accroche.", "## Conclusion", "Réponse."].join("\n"),
    );
    expect(r.template.sections.map((s) => s.title)).toEqual(["Introduction", "Conclusion"]);
    expect(r.template.constraints).not.toMatch(/THÈME/);
  });
});

describe("bornes des lignes de la trame : jamais de coupe silencieuse", () => {
  it("devrait accepter jusqu'à 30 lignes", () => {
    const many = Array.from({ length: 30 }, (_, i) => `${i + 1}. Partie ${i + 1}`).join("\n");
    const r = parse(many);
    expect(r.template.sections).toHaveLength(LIMITS.maxSections);
    expect(r.warnings.filter((w) => /ligne/.test(w))).toEqual([]);
  });

  it("au-delà, devrait garder la fin du plan (conclusion) et lister les lignes coupées", () => {
    const many = [...Array.from({ length: 33 }, (_, i) => `${i + 1}. Partie ${i + 1}`), "34. Conclusion", "35. Ouverture"].join("\n");
    const r = parse(many);
    const titles = r.template.sections.map((s) => s.title);
    expect(titles).toHaveLength(30);
    expect(titles.slice(-2)).toEqual(["Conclusion", "Ouverture"]);
    const warning = r.warnings.find((w) => /La trame compte au plus 30 lignes/.test(w));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/Partie 33/);
  });

  it("devrait signaler une ligne ramenée à 8 diapos", () => {
    const r = parse("1. Intro\n2. Développement (12 diapos)\n3. Conclusion");
    expect(r.template.sections[1]!.slides).toBe(8);
    expect(r.warnings.some((w) => /Développement/.test(w) && /8/.test(w) && /maximum par ligne/.test(w))).toBe(true);
  });
});

describe("normalizeTone", () => {
  it.each([
    ["Formal", "fr", "formel"],
    ["professional and engaging", "fr", "professionnel, engageant"],
    ["Academic, concise", "fr", "académique, concis"],
    ["professionnel et dynamique", "fr", "professionnel et dynamique"],
    ["Formal", "en", "Formal"],
  ] as const)("%s (%s) → %s", (tone, lang, expected) => {
    expect(normalizeTone(tone, lang)).toBe(expected);
  });

  it("devrait écarter un ton anglais non traduisible pour un deck français", () => {
    expect(normalizeTone("witty with the audience", "fr")).toBe("");
  });
});

describe("parseTemplateText — colonne Durée du tableau de diapos", () => {
  /** Le tableau de la maquette 1.1.0 (couverture comprise), avec une ligne de Conclusion paramétrable. */
  function trame({ lead = "", conclusion = "3:00", stateOfPlay = "4:00", cover = "0:30" } = {}) {
    return [
      lead,
      "| Diapo | Titre | Contenu type | Durée |",
      "|-------|-------|--------------|-------|",
      `| 1 | Titre | La problématique tirée, mon nom, la date | ${cover} |`,
      "| 2-3 | Contexte | Pourquoi la question se pose : enjeu, deux chiffres clés sourcés | 3:00 |",
      `| 4-5 | État des lieux | Acteurs, contraintes, risques ; un schéma si possible | ${stateOfPlay} |`,
      "| 6-8 | Pistes | Deux ou trois solutions, avec avantages et limites | 6:00 |",
      "| 9 | Recommandation | La piste retenue, sa mise en œuvre et son coût | 3:30 |",
      `| 10 | Conclusion | Réponse directe à la problématique, puis une ouverture | ${conclusion} |`,
    ].join("\n");
  }

  it("devrait lire durées, plages et contenu type, et déduire la durée de l'oral de leur somme", () => {
    const r = parse(trame());
    expect(r.template.sections.map((s) => [s.title, s.slides, s.seconds])).toEqual([
      ["Contexte", 2, 180],
      ["État des lieux", 2, 240],
      ["Pistes", 3, 360],
      ["Recommandation", 1, 210],
      ["Conclusion", 1, 180],
    ]);
    expect(r.template.sections[0]!.guidance).toBe("Pourquoi la question se pose : enjeu, deux chiffres clés sourcés");
    expect(r.template.durationMinutes).toBe(20);
    expect(r.recognized).toEqual(expect.arrayContaining(["durationMinutes", "sections"]));
    expect(r.found).toEqual(expect.arrayContaining(["Durée : 20 min (somme des diapos)", "5 lignes", "Durées des diapos"]));
    expect(r.warnings.some((w) => /Durée non précisée/.test(w))).toBe(false);
    // Le minutage de la trame retombe sur les durées du tableau : 0:30 de couverture, puis 3:00, 4:00…
    expect(templateTimings(r.template).sections.map((s) => [s.start, s.end])).toEqual([
      [30, 210],
      [210, 450],
      [450, 810],
      [810, 1020],
      [1020, 1200],
    ]);
  });

  it("ne devrait jamais prendre la colonne Durée pour le contenu type", () => {
    const r = parse(["| # | Titre | Durée |", "|---|---|---|", "| 1 | Intro | 2:00 |", "| 2 | Conclusion | 1:00 |"].join("\n"));
    expect(r.template.sections.map((s) => [s.title, s.guidance, s.seconds])).toEqual([
      ["Intro", "", 120],
      ["Conclusion", "", 60],
    ]);
  });

  it("devrait garder la durée d'oral écrite dans le texte, sans mention de somme", () => {
    const r = parse(trame({ lead: "Oral de 25 min, 16:9." }));
    expect(r.template.durationMinutes).toBe(25);
    expect(r.found).toContain("Durée : 25 min");
    expect(r.found.some((f) => /somme des diapos/.test(f))).toBe(false);
    expect(r.template.sections.map((s) => s.seconds)).toEqual([180, 240, 360, 210, 180]);
  });

  it("devrait signaler une durée illisible et laisser la ligne en calcul automatique", () => {
    const r = parse(trame({ stateOfPlay: "bientôt" }));
    const line = r.template.sections.find((s) => s.title === "État des lieux")!;
    expect(line.seconds).toBeUndefined();
    expect(r.warnings).toContain("Durée « bientôt » illisible pour « État des lieux » : calculée automatiquement.");
    expect(r.template.sections.filter((s) => s.seconds !== undefined)).toHaveLength(4);
    // Toutes les lignes n'ont pas de durée : la durée de l'oral n'est pas déduite (valeur actuelle de la trame).
    expect(r.recognized).not.toContain("durationMinutes");
    expect(r.template.durationMinutes).toBe(base.durationMinutes);
  });

  it("devrait signaler une durée hors limites (moins de 10 s) et la calculer automatiquement", () => {
    const r = parse(trame({ conclusion: "0:05" }));
    expect(r.template.sections.at(-1)!.seconds).toBeUndefined();
    expect(r.warnings).toContain("Durée « 0:05 » hors limites pour « Conclusion » (10 s à 90 min) : calculée automatiquement.");
  });

  it("devrait ignorer toutes les durées si leur total dépasse la durée d'oral écrite dans le texte", () => {
    const r = parse(trame({ lead: "Oral de 20 min.", conclusion: "4:00" }));
    expect(r.template.durationMinutes).toBe(20);
    expect(r.template.sections.every((s) => s.seconds === undefined)).toBe(true);
    expect(r.warnings).toContain("Durées des diapos ignorées : leur total (21:00) dépasse la durée de l'oral (20 min).");
    expect(r.found).not.toContain("Durées des diapos");
  });

  it("devrait ignorer les durées qui ne laissent pas 10 s par diapo aux lignes sans durée", () => {
    // 20 min : 0:30 de couverture + 19:30 de lignes fixées = 0:00 pour la conclusion, sans durée.
    const r = parse(trame({ lead: "Oral de 20 min.", stateOfPlay: "7:00", conclusion: "" }));
    expect(r.template.durationMinutes).toBe(20);
    expect(r.template.sections.every((s) => s.seconds === undefined)).toBe(true);
    expect(r.warnings.some((w) => /Durées des diapos ignorées/.test(w))).toBe(true);
  });

  it("devrait compter la durée de la couverture du tableau dans la durée de l'oral", () => {
    const r = parse(trame({ cover: "1:00" }));
    // 19:30 de lignes + 1:00 de couverture = 20:30 → 21 min.
    expect(r.template.durationMinutes).toBe(21);
    expect(r.template.sections.map((s) => s.seconds)).toEqual([180, 240, 360, 210, 180]);
  });

  it("devrait réserver au moins les 30 s de la couverture de l'application, même si le tableau en prévoit moins", () => {
    const r = parse(trame({ cover: "0:10", conclusion: "3:20" }));
    // 19:50 de lignes : avec 0:10 de couverture, 20 min ne laisseraient que 19:30 aux lignes (couverture de 30 s).
    expect(r.template.durationMinutes).toBe(21);
    expect(r.template.sections.at(-1)!.seconds).toBe(200);
  });

  it("devrait rester dans les bornes de l'oral (90 min) et alors ignorer des durées qui ne tiennent plus", () => {
    const r = parse(
      ["| # | Titre | Durée |", "|---|---|---|", "| 1 | Partie A | 40:00 |", "| 2 | Partie B | 40:00 |", "| 3 | Partie C | 40:00 |"].join("\n"),
    );
    expect(r.template.durationMinutes).toBe(90);
    expect(r.template.sections.every((s) => s.seconds === undefined)).toBe(true);
    expect(r.warnings.some((w) => /Durées des diapos ignorées/.test(w))).toBe(true);
  });

  it("devrait retirer les durées de la trame actuelle qui ne tiennent plus dans une durée d'oral plus courte, sans les dire reconnues", () => {
    const timed = { ...base, sections: base.sections.map((sec) => ({ ...sec, seconds: 60 })) };
    const r = parseTemplateText("Oral de 5 min.", timed);
    expect(PromptTemplateSchema.safeParse(r.template).success).toBe(true);
    expect(r.template.durationMinutes).toBe(5);
    expect(r.template.sections.map((sec) => sec.title)).toEqual(base.sections.map((sec) => sec.title));
    expect(r.template.sections.every((sec) => sec.seconds === undefined)).toBe(true);
    expect(r.recognized).toContain("durationMinutes");
    expect(r.recognized).not.toContain("sections");
    expect(r.warnings.some((w) => /Durées des lignes actuelles ignorées/.test(w))).toBe(true);
  });
});
