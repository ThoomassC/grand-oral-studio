import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckSpec } from "@/domain/schemas";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";

const actions = {
  updateDeckSlide: vi.fn(),
  insertSlideAfter: vi.fn(),
  removeSlide: vi.fn(),
  moveSlide: vi.fn(),
  regenerateSlide: vi.fn(),
  duplicateDeck: vi.fn(),
};
vi.mock("next/navigation", () => ({
  usePathname: () => "/projets/p1/decks/d1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/actions/decks", () =>
  Object.fromEntries(Object.entries(actions).map(([name, fn]) => [name, (...a: unknown[]) => fn(...a)])),
);

const { DeckReview } = await import("@/components/decks/DeckReview");
const { UnsavedChangesProvider } = await import("@/components/layout/UnsavedChanges");

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const fn of Object.values(actions)) fn.mockReset();
});

const VERSION = "2026-10-07T08:00:00.000Z";
const NEXT = "2026-10-07T08:01:00.000Z";
const SPEC = makeConformingDeck();

function renderReview(props: Partial<Parameters<typeof DeckReview>[0]> = {}) {
  return render(
    <UnsavedChangesProvider>
      <DeckReview
        deckId="d1"
        initialSpec={SPEC}
        initialUpdatedAt={VERSION}
        brand={makeBrand()}
        template={makeTemplate()}
        canEdit
        aiAvailable
        canDuplicate
        decksHref="/projets/p1/decks"
        {...props}
      />
    </UnsavedChangesProvider>,
  );
}

/** Nom d'un bouton « Libellé<span sr-only> la diapo N</span> » (jsdom ne garde pas l'espace de tête du texte masqué). */
const action = (label: string, n: number) => new RegExp(`^${label}\\s*la diapo ${n}$`);
const card = (n: number) => document.getElementById(`diapo-${n}`)!;
const moved = (spec: DeckSpec, from: number, to: number): DeckSpec => {
  const slides = [...spec.slides];
  const [s] = slides.splice(from, 1);
  slides.splice(to, 0, s!);
  return { ...spec, slides };
};

describe("DeckReview — ancres et liens « Diapo N »", () => {
  it("devrait poser l'ancre diapo-N sur chaque carte", () => {
    renderReview();
    expect(card(1)).toHaveTextContent(SPEC.slides[0]!.title);
    expect(card(9)).toHaveTextContent(SPEC.slides[8]!.title);
  });

  it("devrait relier chaque point à vérifier aux diapos concernées", () => {
    // Notes de consigne (trop courtes) : alerte « Notes d'orateur » sur les diapos 2 à 9.
    renderReview({ reviewProblem: "Comment concilier mobilité et sobriété en ville" });
    const notesItem = screen.getByText(/^Notes d'orateur recopiées/).closest("li")!;
    const links = within(notesItem).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Diapo 2", "Diapo 3", "Diapo 4", "Diapo 5", "Diapo 6", "Diapo 7", "Diapo 8", "Diapo 9"]);
    expect(links[0]).toHaveAttribute("href", "#diapo-2");
  });

  it("n'affiche pas de relecture sans problématique (deck sans IA)", () => {
    renderReview();
    expect(screen.queryByText(/à vérifier avant l'oral/)).not.toBeInTheDocument();
  });
});

describe("DeckReview — structure du diaporama", () => {
  it("ne propose ni monter, ni descendre, ni supprimer la couverture", () => {
    renderReview();
    const cover = within(card(1));
    expect(cover.getByRole("button", { name: action("Insérer une diapo après", 1) })).toBeInTheDocument();
    expect(cover.queryByRole("button", { name: /^Monter/ })).not.toBeInTheDocument();
    expect(cover.queryByRole("button", { name: /^Descendre/ })).not.toBeInTheDocument();
    expect(cover.queryByRole("button", { name: /^Supprimer/ })).not.toBeInTheDocument();
    // La diapo qui suit la couverture ne monte pas ; la dernière ne descend pas.
    expect(within(card(2)).queryByRole("button", { name: /^Monter/ })).not.toBeInTheDocument();
    expect(within(card(9)).queryByRole("button", { name: /^Descendre/ })).not.toBeInTheDocument();
  });

  it("devrait insérer une diapo après la diapo visée et ouvrir son édition", async () => {
    const inserted: DeckSpec = {
      ...SPEC,
      slides: [...SPEC.slides.slice(0, 4), { layout: "content", sectionId: "part1", title: "Nouvelle diapo", subtitle: "", bullets: [], notes: "" }, ...SPEC.slides.slice(4)],
    };
    actions.insertSlideAfter.mockResolvedValue({ ok: true, data: { spec: inserted, updatedAt: NEXT } });
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: action("Insérer une diapo après", 4) }));
    expect(actions.insertSlideAfter).toHaveBeenCalledWith("d1", 3, VERSION);
    expect(await screen.findByRole("heading", { name: "10 diapos" })).toBeInTheDocument();
    expect(within(card(5)).getByLabelText("Titre")).toHaveValue("Nouvelle diapo");
  });

  it("devrait descendre une diapo puis envoyer la nouvelle version au déplacement suivant", async () => {
    actions.moveSlide
      .mockResolvedValueOnce({ ok: true, data: { spec: moved(SPEC, 3, 4), updatedAt: NEXT } })
      .mockResolvedValueOnce({ ok: true, data: { spec: SPEC, updatedAt: "2026-10-07T08:02:00.000Z" } });
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: action("Descendre", 4) }));
    expect(actions.moveSlide).toHaveBeenCalledWith("d1", 3, "down", VERSION);
    await waitFor(() => expect(card(5)).toHaveTextContent(SPEC.slides[3]!.title));
    expect(screen.getByText(`Diapo 4 déplacée en position 5.`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: action("Monter", 5) }));
    expect(actions.moveSlide).toHaveBeenLastCalledWith("d1", 4, "up", NEXT);
  });

  it("devrait afficher le refus du serveur et proposer de recharger en cas de conflit", async () => {
    actions.moveSlide.mockResolvedValue({ ok: false, code: "CONFLICT", error: "Ce diaporama a changé entre-temps (autre onglet)." });
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: action("Monter", 4) }));
    const alert = within(card(4)).getByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("Ce diaporama a changé entre-temps (autre onglet)."));
    expect(within(alert).getByRole("button", { name: "Recharger le diaporama" })).toBeInTheDocument();
  });

  it("devrait afficher une borne refusée sans proposer de recharger", async () => {
    actions.insertSlideAfter.mockResolvedValue({ ok: false, code: "VALIDATION", error: "Un diaporama compte au plus 60 diapos." });
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: action("Insérer une diapo après", 3) }));
    const alert = within(card(3)).getByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("Un diaporama compte au plus 60 diapos."));
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  it("devrait supprimer une diapo après confirmation", async () => {
    actions.removeSlide.mockResolvedValue({
      ok: true,
      data: { spec: { ...SPEC, slides: SPEC.slides.filter((_, i) => i !== 5) }, updatedAt: NEXT },
    });
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Supprimer la diapo 6" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer la diapo ?" });
    await user.click(within(dialog).getByRole("button", { name: "Supprimer la diapo" }));
    expect(actions.removeSlide).toHaveBeenCalledWith("d1", 5, VERSION);
    expect(await screen.findByRole("heading", { name: "8 diapos" })).toBeInTheDocument();
  });
});

describe("DeckReview — régénération par IA", () => {
  it("devrait régénérer une diapo après confirmation", async () => {
    const rewritten = { ...SPEC.slides[3]!, title: "Un constat réécrit" };
    actions.regenerateSlide.mockResolvedValue({
      ok: true,
      data: { spec: { ...SPEC, slides: SPEC.slides.map((s, i) => (i === 3 ? rewritten : s)) }, updatedAt: NEXT },
    });
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Régénérer la diapo 4 avec l'IA" }));
    const dialog = await screen.findByRole("dialog", { name: "Régénérer la diapo ?" });
    await user.click(within(dialog).getByRole("button", { name: "Régénérer la diapo" }));
    expect(actions.regenerateSlide).toHaveBeenCalledWith("d1", 3, VERSION);
    await waitFor(() => expect(card(4)).toHaveTextContent("Un constat réécrit"));
  });

  it("devrait afficher l'erreur IA dans la confirmation", async () => {
    actions.regenerateSlide.mockResolvedValue({ ok: false, code: "AI_UNAVAILABLE", error: "Le service de génération est momentanément indisponible." });
    const user = userEvent.setup();
    renderReview();
    await user.click(screen.getByRole("button", { name: "Régénérer la diapo 4 avec l'IA" }));
    const dialog = await screen.findByRole("dialog", { name: "Régénérer la diapo ?" });
    await user.click(within(dialog).getByRole("button", { name: "Régénérer la diapo" }));
    expect(await within(dialog).findByText("Le service de génération est momentanément indisponible.")).toBeInTheDocument();
  });

  it("Sans IA : devrait masquer la régénération et le dire", () => {
    renderReview({ aiAvailable: false });
    expect(screen.queryByRole("button", { name: /Régénérer/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Régénérer une diapo : disponible avec une rédaction IA/)).toBeInTheDocument();
  });
});

describe("DeckReview — lecteur", () => {
  it("ne devrait proposer aucune modification à un lecteur", () => {
    renderReview({ canEdit: false });
    expect(screen.queryByRole("button", { name: /^Modifier/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Insérer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dupliquer le diaporama/ })).not.toBeInTheDocument();
  });

  it("devrait proposer la duplication à un éditeur", () => {
    renderReview();
    expect(screen.getByRole("button", { name: "Dupliquer le diaporama" })).toBeInTheDocument();
  });
});
