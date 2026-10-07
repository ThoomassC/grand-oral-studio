import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
const remove = vi.fn();
const restore = vi.fn();
const duplicate = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/server/actions/decks", () => ({
  deleteDeck: (...a: unknown[]) => remove(...a),
  restoreDeck: (...a: unknown[]) => restore(...a),
  duplicateDeck: (...a: unknown[]) => duplicate(...a),
}));

const { ToastProvider } = await import("@thomascaron/opale-ui");
const { DeleteDeckButton, DuplicateDeckButton } = await import("@/components/decks/DeckActions");

afterEach(() => {
  cleanup();
  for (const fn of [router.push, router.refresh, router.replace, remove, restore, duplicate]) fn.mockReset();
});

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Supprimer le diaporama Mobilités" }));
  const dialog = await screen.findByRole("dialog", { name: "Supprimer le diaporama ?" });
  return dialog;
}

describe("DeleteDeckButton — suppression annulable", () => {
  it("devrait annoncer l'annulation possible, puis restaurer le diaporama depuis la notification", async () => {
    remove.mockResolvedValue({ ok: true, data: { undoUntil: "2026-10-07T08:00:30.000Z" } });
    restore.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DeleteDeckButton deckId="d1" label="Mobilités" redirectTo="/projets/p1/decks" />
      </ToastProvider>,
    );

    const dialog = await confirmDelete(user);
    expect(dialog).toHaveTextContent("Vous pourrez annuler pendant quelques secondes.");
    expect(dialog).not.toHaveTextContent("définitive");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer le diaporama" }));

    expect(remove).toHaveBeenCalledWith("d1");
    expect(router.replace).toHaveBeenCalledWith("/projets/p1/decks");
    expect(await screen.findByText("Diaporama supprimé.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Annuler la suppression du diaporama Mobilités" }));
    expect(restore).toHaveBeenCalledWith("d1");
    expect(await screen.findByText("Diaporama restauré.")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("devrait afficher l'échec de l'annulation", async () => {
    remove.mockResolvedValue({ ok: true, data: { undoUntil: "2026-10-07T08:00:30.000Z" } });
    restore.mockResolvedValue({ ok: false, error: "Ce diaporama est introuvable." });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DeleteDeckButton deckId="d1" label="Mobilités" />
      </ToastProvider>,
    );
    await user.click(within(await confirmDelete(user)).getByRole("button", { name: "Supprimer le diaporama" }));
    await user.click(await screen.findByRole("button", { name: "Annuler la suppression du diaporama Mobilités" }));
    expect(await screen.findByText("Annulation impossible.")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("un ancien squelette reste supprimé définitivement : pas d'annulation proposée", async () => {
    remove.mockResolvedValue({ ok: true, data: { undoUntil: null } });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DeleteDeckButton deckId="s1" label="Mobilités" undoable={false} />
      </ToastProvider>,
    );
    const dialog = await confirmDelete(user);
    expect(dialog).toHaveTextContent("Cette action est définitive.");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer le diaporama" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("s1"));
    expect(screen.queryByText("Diaporama supprimé.")).not.toBeInTheDocument();
  });
});

describe("DuplicateDeckButton", () => {
  it("devrait dupliquer puis ouvrir la copie", async () => {
    duplicate.mockResolvedValue({ ok: true, data: { deckId: "d2" } });
    const user = userEvent.setup();
    render(<DuplicateDeckButton deckId="d1" decksHref="/projets/p1/decks" />);
    await user.click(screen.getByRole("button", { name: "Dupliquer le diaporama" }));
    expect(duplicate).toHaveBeenCalledWith("d1");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/projets/p1/decks/d2?copie=1"));
  });

  it("devrait afficher l'erreur", async () => {
    duplicate.mockResolvedValue({ ok: false, error: "Vous n'avez pas les droits pour cette action sur ce projet." });
    const user = userEvent.setup();
    render(<DuplicateDeckButton deckId="d1" decksHref="/projets/p1/decks" />);
    await user.click(screen.getByRole("button", { name: "Dupliquer le diaporama" }));
    expect(await screen.findByText("Vous n'avez pas les droits pour cette action sur ce projet.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
