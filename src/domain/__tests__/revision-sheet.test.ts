import { describe, expect, it } from "vitest";
import { buildDeckNotesSheet, buildRevisionSheet, findFigure } from "@/domain/revision-sheet";
import type { DeckSpec } from "@/domain/schemas";
import { makeConformingDeck, makeTemplate, makeThemes } from "@/test/fixtures";

function withNotes(deck: DeckSpec, notes: Record<number, string>): DeckSpec {
  return { ...deck, slides: deck.slides.map((s, i) => (i in notes ? { ...s, notes: notes[i]! } : s)) };
}

const subject = {
  ...makeThemes()[0]!,
  keywords: ["énergie", "Énergie", "climat"],
  notes:
    "La part du transport atteint 31 % des émissions. En 2023, le parc a changé.\n" +
    "Source : Ministère, bilan 2023.\n" +
    "Voir https://example.org/rapport.\n" +
    "[source à trouver]",
};

describe("buildRevisionSheet", () => {
  it("devrait titrer la fiche du nom du sujet", () => {
    expect(buildRevisionSheet(subject, null).title).toBe("Transition énergétique");
  });

  it("devrait titrer la fiche du titre du diaporama sans sujet, puis par défaut", () => {
    expect(buildRevisionSheet(null, makeConformingDeck()).title).toBe("Faut-il repenser nos mobilités");
    expect(buildRevisionSheet(null, null)).toEqual({ title: "Fiche de révision", keyFigures: [], sources: [], keywords: [], outline: [] });
  });

  it("devrait relever la phrase de chaque chiffre accompagné d'une unité", () => {
    expect(buildRevisionSheet(subject, null).keyFigures).toEqual(["La part du transport atteint 31 % des émissions."]);
  });

  it("devrait relever les chiffres des notes du diaporama", () => {
    const deck = withNotes(makeConformingDeck(), { 3: "[3:00–5:00] Le secteur émet 12 millions de tonnes par an." });
    expect(buildRevisionSheet(null, deck).keyFigures).toEqual(["Le secteur émet 12 millions de tonnes par an."]);
  });

  it.each(["Le budget atteint 1\u00A0200\u00A0000 €.", "Le budget atteint 1\u202F200 €.", "Le budget atteint 3,5 milliards."])(
    "devrait relever un chiffre à séparateur de milliers ou décimal : %s",
    (notes) => {
      expect(buildRevisionSheet({ ...subject, notes }, null).keyFigures).toEqual([notes]);
    },
  );

  it("ne devrait pas prendre une année ou une numérotation pour un chiffre clé", () => {
    expect(buildRevisionSheet({ ...subject, notes: "En 2023, la partie 2 change." }, null).keyFigures).toEqual([]);
  });

  it("devrait relever les lignes « Source : » et les URL, sans les marqueurs à compléter", () => {
    expect(buildRevisionSheet(subject, null).sources).toEqual(["Ministère, bilan 2023.", "https://example.org/rapport"]);
  });

  it("devrait reprendre les mots-clés du sujet sans doublon de casse ni d'accent", () => {
    expect(buildRevisionSheet(subject, null).keywords).toEqual(["énergie", "climat"]);
  });

  it("devrait construire le plan par ligne du diaporama, sans la couverture", () => {
    const outline = buildRevisionSheet(null, makeConformingDeck()).outline.map((o) => o.title);
    expect(outline).toEqual(["Un quotidien en mouvement", "La question posée", "Un constat chiffré", "Les leviers techniques", "Vers une mobilité choisie"]);
  });

  it("devrait donner la durée d'une ligne quand toutes ses diapos portent un repère", () => {
    const deck = withNotes(makeConformingDeck(), { 3: "[2:30–4:00] a", 4: "[4:00–6:00] b" });
    const outline = buildRevisionSheet(null, deck).outline;
    expect(outline[2]).toEqual({ title: "Un constat chiffré", minutes: 3.5 });
    expect(outline[0]).toEqual({ title: "Un quotidien en mouvement" });
  });

  it("devrait retirer la numérotation « (1/2) » du titre d'une ligne", () => {
    const deck = makeConformingDeck();
    const numbered: DeckSpec = { ...deck, slides: deck.slides.map((s, i) => (i === 3 ? { ...s, title: "Premier axe (1/2)" } : s)) };
    expect(buildRevisionSheet(null, numbered).outline[2]?.title).toBe("Premier axe");
  });
});

describe("findFigure", () => {
  it.each([
    { text: "soit 1\u00A0200\u00A0000 € par an", figure: "1\u00A0200\u00A0000 €" },
    { text: "soit 1\u202F200 € par an", figure: "1\u202F200 €" },
    { text: "soit 1 200 tonnes", figure: "1 200 tonnes" },
    { text: "près de 3,5 milliards", figure: "3,5 milliards" },
    { text: "en 2023", figure: null },
  ])("devrait extraire « $figure » de « $text »", ({ text, figure }) => {
    expect(findFigure(text)).toBe(figure);
  });
});

describe("buildDeckNotesSheet", () => {
  const deck = withNotes(makeConformingDeck(), { 0: "[0:00–0:30] Bonjour à tous." });
  const sheet = buildDeckNotesSheet(deck, makeTemplate());

  it("devrait reprendre titre et durée", () => {
    expect(sheet.title).toBe("Faut-il repenser nos mobilités");
    expect(sheet.durationMinutes).toBe(20);
  });

  it("devrait minuter chaque diapo de bout en bout de l'oral", () => {
    expect(sheet.slides).toHaveLength(9);
    expect(sheet.slides[0]).toMatchObject({ number: 1, start: 0, end: 30, timing: "0:00–0:30", sectionTitle: "Couverture" });
    expect(sheet.slides[8]?.end).toBe(1200);
    expect(sheet.slides[8]?.timing).toMatch(/–20:00$/);
  });

  it("devrait retirer le repère de minutage des notes affichées", () => {
    expect(sheet.slides[0]?.notes).toBe("Bonjour à tous.");
  });

  it("devrait nommer chaque diapo de sa ligne de trame", () => {
    expect(sheet.slides[5]?.sectionTitle).toBe("Second axe");
  });

  it("devrait donner le plan par ligne, couverture comprise, avec son minutage", () => {
    expect(sheet.plan.map((p) => p.title)).toEqual(["Couverture", "Introduction", "Problématique", "Premier axe", "Second axe", "Conclusion"]);
    expect(sheet.plan[0]).toMatchObject({ start: 0, end: 30, timing: "0:00–0:30" });
  });
});
