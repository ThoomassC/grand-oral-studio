import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JuryQuestionItem } from "@/components/decks/JuryQuestions";

const generateJuryQuestions = vi.fn();
const setQuestionReview = vi.fn();
vi.mock("@/server/actions/practice", () => ({
  generateJuryQuestions: (...args: unknown[]) => generateJuryQuestions(...args),
  setQuestionReview: (...args: unknown[]) => setQuestionReview(...args),
}));

const { JuryQuestions } = await import("@/components/decks/JuryQuestions");

afterEach(() => {
  cleanup();
  generateJuryQuestions.mockReset();
  setQuestionReview.mockReset();
});

const QUESTIONS: JuryQuestionItem[] = [
  { id: "q1", question: "Pourquoi ce sujet ?", answer: "Parce qu'il me concerne.", status: null },
  { id: "q2", question: "Quelle limite ?", answer: "Le coût.", status: "to_review" },
  { id: "q3", question: "Quelle source ?", answer: "Insee, 2024.", status: "known" },
];

const card = (question: string) =>
  screen.getAllByRole("listitem").find((li) => within(li).queryByRole("heading", { name: new RegExp(question.replace("?", "\\?")) }))!;

describe("JuryQuestions — révision", () => {
  it("devrait révéler les éléments de réponse à la demande", async () => {
    const user = userEvent.setup();
    render(<JuryQuestions deckId="d1" canEdit={false} initialQuestions={QUESTIONS} />);
    const first = card("Pourquoi ce sujet ?");
    expect(within(first).queryByText("Parce qu'il me concerne.")).not.toBeInTheDocument();
    const toggle = within(first).getByRole("button", { name: /^Voir les éléments de réponse/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(within(first).getByText("Parce qu'il me concerne.")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: /^Masquer les éléments de réponse/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("devrait compter les questions à revoir et filtrer sur elles", async () => {
    setQuestionReview.mockResolvedValue({ ok: true, data: { status: "known" } });
    const user = userEvent.setup();
    render(<JuryQuestions deckId="d1" canEdit={false} initialQuestions={QUESTIONS} />);
    // Non marquée ou « À revoir » : à revoir. Seule « Je sais répondre » sort du compte.
    expect(screen.getByText("2 à revoir")).toBeInTheDocument();

    await user.click(within(card("Pourquoi ce sujet ?")).getByRole("button", { name: /^Je sais répondre/ }));
    expect(setQuestionReview).toHaveBeenCalledWith("q1", "known");
    expect(screen.getByText("1 à revoir")).toBeInTheDocument();
    expect(within(card("Pourquoi ce sujet ?")).getByRole("button", { name: /^Je sais répondre/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("checkbox", { name: "À revoir seulement" }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      expect.stringContaining("Quelle limite ?"),
    ]);
  });

  it("devrait annuler le marquage et l'expliquer si l'enregistrement échoue", async () => {
    setQuestionReview.mockResolvedValue({ ok: false, error: "Trop d'enregistrements en peu de temps. Réessayez dans 3 min." });
    const user = userEvent.setup();
    render(<JuryQuestions deckId="d1" canEdit={false} initialQuestions={QUESTIONS} />);
    await user.click(within(card("Quelle source ?")).getByRole("button", { name: /^À revoir/ }));
    expect(setQuestionReview).toHaveBeenCalledWith("q3", "to_review");
    expect(await screen.findByRole("alert")).toHaveTextContent("Trop d'enregistrements");
    expect(screen.getByText("2 à revoir")).toBeInTheDocument();
    expect(within(card("Quelle source ?")).getByRole("button", { name: /^Je sais répondre/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("devrait indiquer qu'il n'y a plus rien à revoir quand le filtre ne laisse aucune question", async () => {
    const user = userEvent.setup();
    const allKnown = QUESTIONS.map((q) => ({ ...q, status: "known" as const }));
    render(<JuryQuestions deckId="d1" canEdit={false} initialQuestions={allKnown} />);
    expect(screen.getByText("0 à revoir")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "À revoir seulement" }));
    expect(screen.getByText(/Rien à revoir/)).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });
});

describe("JuryQuestions — préparation", () => {
  it("devrait préparer les questions pour un éditeur quand il n'y en a pas", async () => {
    generateJuryQuestions.mockResolvedValue({ ok: true, data: { questions: QUESTIONS.slice(0, 2), engine: "free" } });
    const user = userEvent.setup();
    render(<JuryQuestions deckId="d1" canEdit initialQuestions={[]} />);
    expect(screen.getByText("Aucune question préparée pour ce diaporama.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Préparer les questions" }));
    expect(generateJuryQuestions).toHaveBeenCalledWith("d1");
    expect(await screen.findByRole("heading", { level: 3, name: /Pourquoi ce sujet \?/ })).toBeInTheDocument();
    expect(screen.getByText("2 à revoir")).toBeInTheDocument();
    expect(screen.getByText("2 questions préparées.")).toBeInTheDocument();
  });

  it("devrait afficher l'erreur de préparation sans perdre l'état", async () => {
    generateJuryQuestions.mockResolvedValue({ ok: false, error: "Vous n'avez pas les droits pour cette action sur ce projet." });
    const user = userEvent.setup();
    render(<JuryQuestions deckId="d1" canEdit initialQuestions={[]} />);
    await user.click(screen.getByRole("button", { name: "Préparer les questions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vous n'avez pas les droits");
    expect(screen.getByRole("button", { name: "Préparer les questions" })).toBeInTheDocument();
  });

  it("devrait demander confirmation avant de remplacer des questions existantes", async () => {
    generateJuryQuestions.mockResolvedValue({ ok: true, data: { questions: [QUESTIONS[2]!], engine: "free" } });
    const user = userEvent.setup();
    render(<JuryQuestions deckId="d1" canEdit initialQuestions={QUESTIONS} />);
    await user.click(screen.getByRole("button", { name: "Préparer de nouvelles questions" }));
    const dialog = screen.getByRole("dialog", { name: "Remplacer les questions ?" });
    expect(generateJuryQuestions).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Remplacer les questions" }));
    expect(generateJuryQuestions).toHaveBeenCalledWith("d1");
    expect(await screen.findByText("0 à revoir")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("ne devrait proposer aucune préparation à un lecteur", () => {
    render(<JuryQuestions deckId="d1" canEdit={false} initialQuestions={[]} />);
    expect(screen.queryByRole("button", { name: /Préparer/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Un éditeur du projet peut les préparer/)).toBeInTheDocument();
  });
});
