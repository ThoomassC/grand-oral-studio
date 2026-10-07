import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeckNotice } from "@/components/day/DeckNotice";
import { ExamChecklist } from "@/components/day/ExamChecklist";
import { deckNoticeKey, parseDeckNotice, storeDeckNotice } from "@/components/day/deck-notice";
import { examChecklist } from "@/domain/exam-checklist";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("DeckNotice — avertissements de génération, une seule fois", () => {
  it("devrait afficher les avertissements rangés pour ce diaporama, puis effacer la clé", () => {
    storeDeckNotice("d1", ["Conclusion à relire.", "Chiffre sans source diapo 4."]);
    render(<DeckNotice deckId="d1" />);
    expect(screen.getByText("À relire avant de présenter")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Conclusion à relire.",
      "Chiffre sans source diapo 4.",
    ]);
    expect(window.sessionStorage.getItem(deckNoticeKey("d1"))).toBeNull();
  });

  it("ne devrait rien afficher sans avertissement, ni pour un autre diaporama", () => {
    storeDeckNotice("d2", []);
    storeDeckNotice("d3", ["Pour d3."]);
    const { container } = render(<DeckNotice deckId="d2" />);
    expect(container).toBeEmptyDOMElement();
    expect(window.sessionStorage.getItem(deckNoticeKey("d3"))).not.toBeNull();
  });

  it("devrait ignorer une valeur illisible ou d'une autre version", () => {
    expect(parseDeckNotice("{")).toBeNull();
    expect(parseDeckNotice(JSON.stringify({ v: 2, warnings: ["x"] }))).toBeNull();
    expect(parseDeckNotice(JSON.stringify({ v: 1, warnings: [1, " ", "ok"] }))).toEqual({ warnings: ["ok"] });
  });
});

describe("ExamChecklist — liste « Avant l'examen »", () => {
  const base = { writerReady: true, writerLabel: "Mistral (votre clé)", templateSaved: true, exportTried: true, practiceDecks: 2, rehearsals: 2 };

  it("devrait lister ce qui reste à faire, avec les indications", () => {
    render(<ExamChecklist items={examChecklist({ ...base, exportTried: false, rehearsals: 1 })} />);
    expect(screen.getByText("Avant l'examen : 2 points à vérifier")).toBeInTheDocument();
    expect(screen.getByText(/Téléchargez un PPTX d'essai/)).toBeInTheDocument();
    expect(screen.getByText(/\(1 sur 2\)/)).toBeInTheDocument();
    expect(screen.queryByText("Revoir la liste")).not.toBeInTheDocument();
  });

  it("devrait se replier quand tout est fait", () => {
    render(<ExamChecklist items={examChecklist(base)} />);
    expect(screen.getByText("Avant l'examen : tout est prêt")).toBeInTheDocument();
    const details = screen.getByText("Revoir la liste").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });
});
