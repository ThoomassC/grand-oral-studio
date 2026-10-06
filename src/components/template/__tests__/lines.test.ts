import { describe, expect, it } from "vitest";
import {
  DURATION_FORMAT_ERROR,
  draftSignature,
  durationSummary,
  durationTexts,
  lineRangeLabels,
  withDurations,
} from "@/components/template/lines";
import { defaultTemplate } from "@/domain/defaults";
import type { PromptTemplate } from "@/domain/schemas";

function template(sections: PromptTemplate["sections"], durationMinutes = 20): PromptTemplate {
  return { ...defaultTemplate(), durationMinutes, sections };
}

const LINES: PromptTemplate["sections"] = [
  { id: "a", title: "Contexte", guidance: "Enjeu", slides: 2, seconds: 180 },
  { id: "b", title: "Pistes", guidance: "", slides: 3 },
  { id: "c", title: "Conclusion", guidance: "", slides: 1 },
];

describe("lineRangeLabels — diapos couvertes par chaque ligne (couverture = diapo 1)", () => {
  it("devrait cumuler les diapos à partir de la diapo 2", () => {
    expect(lineRangeLabels(LINES)).toEqual(["Diapos 2-3", "Diapos 4-6", "Diapo 7"]);
  });

  it("devrait donner les plages de la trame par défaut", () => {
    expect(lineRangeLabels(defaultTemplate().sections)).toEqual([
      "Diapo 2",
      "Diapo 3",
      "Diapo 4",
      "Diapos 5-7",
      "Diapos 8-10",
      "Diapos 11-12",
      "Diapo 13",
    ]);
  });

  it("ne devrait rien afficher pour une ligne au nombre de diapos illisible, ni pour les suivantes", () => {
    expect(lineRangeLabels([{ slides: 1 }, { slides: Number.NaN }, { slides: 2 }])).toEqual(["Diapo 2", null, null]);
    expect(lineRangeLabels([{ slides: 0 }, { slides: 1 }])).toEqual([null, null]);
  });
});

describe("durationTexts — texte de départ des champs « Durée »", () => {
  it("devrait formater les durées en m:ss et laisser vide une ligne sans durée", () => {
    expect(durationTexts(template(LINES))).toEqual({ a: "3:00", b: "", c: "" });
  });
});

describe("withDurations — saisie des durées convertie à l'enregistrement", () => {
  it("devrait convertir « 3:30 » en 210 secondes", () => {
    const result = withDurations(template(LINES), { a: "3:30", b: "", c: "" });
    expect(result.errors).toEqual({});
    expect(result.template.sections[0]?.seconds).toBe(210);
  });

  it("devrait accepter les autres écritures lues par parseDurationText", () => {
    const result = withDurations(template(LINES), { a: "2 min", b: "90 s", c: "1'15" });
    expect(result.template.sections.map((s) => s.seconds)).toEqual([120, 90, 75]);
  });

  it("devrait retirer la clé `seconds` d'une ligne vidée (pas de `seconds: undefined` ni de null)", () => {
    const result = withDurations(template(LINES), { a: "  ", b: "", c: "" });
    expect(result.errors).toEqual({});
    for (const section of result.template.sections) expect("seconds" in section).toBe(false);
  });

  it("devrait signaler une durée illisible sur le champ de la ligne", () => {
    const result = withDurations(template(LINES), { a: "3:", b: "3", c: "" });
    expect(result.errors).toEqual({
      "sections.0.seconds": [DURATION_FORMAT_ERROR],
      "sections.1.seconds": [DURATION_FORMAT_ERROR],
    });
    expect(DURATION_FORMAT_ERROR).toBe("Durée attendue au format 3:30 (minutes:secondes).");
  });

  it("devrait considérer un texte absent comme vide", () => {
    const result = withDurations(template(LINES), {});
    expect(result.template.sections.map((s) => s.seconds)).toEqual([undefined, undefined, undefined]);
  });
});

describe("draftSignature — comparaison pour la garde « modifications non enregistrées »", () => {
  it("devrait être identique pour la trame enregistrée et ses textes de départ", () => {
    const saved = template(LINES);
    expect(draftSignature(saved, durationTexts(saved))).toBe(draftSignature(saved, durationTexts(saved)));
  });

  it("devrait ignorer l'ordre des clés et une écriture équivalente de la durée", () => {
    const saved = template(LINES);
    const reordered: PromptTemplate = {
      ...saved,
      sections: saved.sections.map(({ seconds, slides, guidance, title, id }) =>
        seconds === undefined ? { slides, guidance, title, id } : { seconds, slides, guidance, title, id },
      ),
    };
    expect(draftSignature(reordered, { a: "3 min", b: "", c: "" })).toBe(draftSignature(saved, durationTexts(saved)));
  });

  it("devrait changer quand une durée est modifiée, effacée ou illisible", () => {
    const saved = template(LINES);
    const base = draftSignature(saved, durationTexts(saved));
    expect(draftSignature(saved, { a: "3:30", b: "", c: "" })).not.toBe(base);
    expect(draftSignature(saved, { a: "", b: "", c: "" })).not.toBe(base);
    expect(draftSignature(saved, { a: "3:00", b: "abc", c: "" })).not.toBe(base);
  });
});

describe("durationSummary — pied de la trame", () => {
  it("devrait additionner les durées lisibles et donner la durée de l'oral", () => {
    expect(durationSummary(template(LINES), { a: "3:00", b: "16:30", c: "" })).toEqual({ fixed: 1170, total: 1200 });
  });

  it("devrait ignorer les durées illisibles", () => {
    expect(durationSummary(template(LINES), { a: "3:00", b: "3:" })).toEqual({ fixed: 180, total: 1200 });
  });

  it("devrait renvoyer null sans aucune durée", () => {
    expect(durationSummary(template(LINES), { a: "", b: "x" })).toBeNull();
  });
});
