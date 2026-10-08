import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvaPanel } from "@/components/decks/CanvaPanel";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("CanvaPanel — copie du prompt", () => {
  it("devrait afficher « Copié ! » sur le bouton pendant 3 secondes, puis revenir au libellé", async () => {
    render(<CanvaPanel prompt="Le prompt" id="canva" />);
    await click(/Copier les consignes Canva/);
    expect(writeText).toHaveBeenCalledWith("Le prompt");
    expect(screen.getByRole("button", { name: "Copié !" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Consignes copiées dans le presse-papiers.");

    act(() => vi.advanceTimersByTime(2_900));
    expect(screen.getByRole("button", { name: "Copié !" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("button", { name: "Copier les consignes Canva" })).toBeInTheDocument();
  });

  it("devrait relancer les 3 secondes à chaque nouvelle copie", async () => {
    render(<CanvaPanel prompt="Le prompt" id="canva" />);
    await click(/Copier les consignes Canva/);
    act(() => vi.advanceTimersByTime(2_000));
    await click(/Copié !/);
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("button", { name: "Copié !" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.getByRole("button", { name: "Copier les consignes Canva" })).toBeInTheDocument();
  });

  it("ne devrait pas afficher « Copié ! » quand la copie automatique échoue", async () => {
    writeText.mockRejectedValue(new Error("refusé"));
    render(<CanvaPanel prompt="Le prompt" id="canva" />);
    await click(/Copier les consignes Canva/);
    expect(screen.queryByRole("button", { name: "Copié !" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("La copie automatique n'est pas disponible");
  });
});
