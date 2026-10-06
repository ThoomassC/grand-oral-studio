import { describe, expect, it } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import { parseTemplateText } from "@/domain/import/template-from-text";
import { PromptTemplateSchema } from "@/domain/schemas";

/** Constats de relecture : durée, plan sous un titre, tableau, couverture, ton. */

const base = { ...defaultTemplate(), durationMinutes: 20 };

function parse(text: string) {
  const r = parseTemplateText(text, base);
  expect(PromptTemplateSchema.safeParse(r.template).success).toBe(true);
  return r;
}

describe("durée : lue dans le texte, sans IA", () => {
  it("devrait reprendre la durée écrite dans le texte", () => {
    const r = parse("Oral de 10 min devant le jury.");
    expect(r.template.durationMinutes).toBe(10);
    expect(r.recognized).toContain("durationMinutes");
    expect(r.found).toContain("Durée : 10 min");
  });

  it("devrait lire « 15 minutes » sans rien signaler", () => {
    const r = parse("Soutenance de 15 minutes.");
    expect(r.template.durationMinutes).toBe(15);
    expect(r.warnings.filter((w) => /durée|min/i.test(w))).toEqual([]);
  });
});

describe("durée : seules les valeurs plausibles liées à l'oral", () => {
  it("ne devrait pas prendre « Rendu sous 48 h » pour une durée d'oral", () => {
    const r = parse("Rendu sous 48 h.\n1. Introduction\n2. Conclusion");
    expect(r.recognized).not.toContain("durationMinutes");
    expect(r.found.some((f) => f.startsWith("Durée"))).toBe(false);
    expect(r.template.durationMinutes).toBe(20);
  });

  it("devrait retenir les minutes même quand une échéance en heures précède", () => {
    expect(parse("Rendu sous 48 h. Oral de 12 min.").template.durationMinutes).toBe(12);
  });

  it("devrait retenir des heures ≤ 2 associées à l'oral, la présentation ou la durée", () => {
    expect(parse("Présentation d'1 h 30 devant le jury").template.durationMinutes).toBe(90);
    expect(parse("Durée : 1 h").template.durationMinutes).toBe(60);
  });

  it("ne devrait pas retenir une durée en heures sans lien avec l'oral", () => {
    expect(parse("Préparation : 2 h en loge.\nPrévoir de l'eau.").recognized).not.toContain("durationMinutes");
  });

  it("devrait ignorer en le signalant une durée d'oral en heures hors bornes", () => {
    const r = parse("Durée : 3 h");
    expect(r.recognized).not.toContain("durationMinutes");
    expect(r.warnings.some((w) => /3 h/.test(w))).toBe(true);
  });

  it("devrait ignorer les durées des blocs de code, des entrées à remplir et des tableaux", () => {
    const r = parse(
      [
        "# Prompt",
        "## Entrées (à remplir)",
        "- DURÉE : 45 min",
        "## Exemple",
        "```",
        "Oral de 30 min",
        "```",
        "| # | Diapo | Temps |",
        "|---|---|---|",
        "| 1 | Intro | 5 min |",
        "| 2 | Conclusion | 2 min |",
      ].join("\n"),
    );
    // Ni 45 ni 30 min : seule la colonne « Temps » du tableau compte, par sa somme (7 min + 30 s de couverture).
    expect(r.template.durationMinutes).toBe(8);
    expect(r.found).toContain("Durée : 8 min (somme des diapos)");
    expect(r.found.some((f) => /45|30 min/.test(f))).toBe(false);
  });
});

describe("sections : liste numérotée sous un titre de plan", () => {
  const prompt = [
    "# Prompt",
    "## Contexte",
    "Oral de fin d'études devant un jury.",
    "## Plan",
    "1. Intro (1 diapo)",
    "2. Développement (3 diapos)",
    "3. Conclusion",
    "## Règles",
    "Pas plus de cinq puces par diapo.",
  ].join("\n");

  it("devrait faire de la liste du plan les sections, pas des titres Contexte / Plan", () => {
    const r = parse(prompt);
    expect(r.template.sections.map((s) => [s.title, s.slides])).toEqual([
      ["Intro", 1],
      ["Développement", 3],
      ["Conclusion", 1],
    ]);
  });

  it("devrait garder le contexte et les règles dans les contraintes", () => {
    const c = parse(prompt).template.constraints;
    expect(c).toMatch(/Oral de fin d'études/);
    expect(c).toMatch(/cinq puces/);
    expect(c).not.toMatch(/Développement/);
  });

  it.each(["Structure", "Sommaire", "Déroulé", "Plan de l'oral"])("devrait reconnaître le titre « %s »", (title) => {
    const r = parse(prompt.replace("## Plan", `## ${title}`));
    expect(r.template.sections.map((s) => s.title)).toEqual(["Intro", "Développement", "Conclusion"]);
  });
});

describe("tableau de diapos : jamais de perte silencieuse", () => {
  const table = (rows: string[]) => ["| # | Diapo | Rôle |", "|---|---|---|", ...rows].join("\n");

  it("devrait lire une plage inversée « 12-9 » comme 4 diapos et le signaler", () => {
    const r = parse(table(["| 1-8 | Partie A | a |", "| 12-9 | Partie B | b |", "| 13 | Conclusion | c |"]));
    expect(r.template.sections.find((s) => s.title === "Partie B")!.slides).toBe(4);
    expect(r.warnings.some((w) => /12-9/.test(w) && /Partie B/.test(w))).toBe(true);
  });

  it("devrait signaler un numéro « 0 »", () => {
    const r = parse(table(["| 0 | Préambule | a |", "| 1 | Partie | b |", "| 2 | Conclusion | c |"]));
    expect(r.warnings.some((w) => /« 0 »/.test(w) && /Préambule/.test(w))).toBe(true);
  });

  it("devrait signaler une ligne sans titre", () => {
    const r = parse(table(["| 1 | Intro | a |", "| 2 |  | rôle orphelin |", "| 3 | Conclusion | c |"]));
    expect(r.template.sections.map((s) => s.title)).toEqual(["Intro", "Conclusion"]);
    expect(r.warnings.some((w) => /sans titre/.test(w) && /2/.test(w))).toBe(true);
  });
});

describe("couverture : titres reconnus", () => {
  it.each(["Titre", "Page titre", "Page de titre"])("devrait écarter « %s » comme couverture", (title) => {
    const r = parse(`1. ${title}\n2. Introduction\n3. Conclusion`);
    expect(r.template.sections.map((s) => s.title)).toEqual(["Introduction", "Conclusion"]);
    expect(r.warnings.some((w) => w.includes(title) && /couverture/.test(w))).toBe(true);
  });
});

describe("ton et métadonnées en gras (analyse sans IA)", () => {
  it("devrait traduire « **Ton** : Formal » et ne pas recopier la ligne dans les contraintes", () => {
    const r = parse("**Ton** : Formal\nCiter deux sources.");
    expect(r.template.tone).toBe("formel");
    expect(r.template.constraints).toBe("Citer deux sources.");
  });

  it("devrait reconnaître « **Durée :** 15 min » sans recopier la ligne", () => {
    const r = parse("**Durée :** 15 min\nCiter deux sources.");
    expect(r.template.durationMinutes).toBe(15);
    expect(r.template.constraints).toBe("Citer deux sources.");
  });

  it("devrait écarter en le signalant un ton anglais non traduisible", () => {
    const r = parse("Tone: witty with the audience");
    expect(r.template.tone).toBe(base.tone);
    expect(r.warnings.some((w) => /witty/.test(w))).toBe(true);
  });
});
