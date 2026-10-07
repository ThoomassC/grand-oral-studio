import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const duplicate = vi.fn();
const remove = vi.fn();
const restore = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }) }));
vi.mock("@/server/actions/programs", () => ({
  duplicateProgram: (...args: unknown[]) => duplicate(...args),
  deleteProgram: (...args: unknown[]) => remove(...args),
  restoreProgram: (...args: unknown[]) => restore(...args),
}));

const { ToastProvider } = await import("@thomascaron/opale-ui");
const { ProgramActions } = await import("@/components/programs/ProgramActions");

afterEach(() => {
  cleanup();
  refresh.mockReset();
  duplicate.mockReset();
  remove.mockReset();
  restore.mockReset();
});

/** Région d'annonce de la ligne (la file des notifications d'Opale, hors de la ligne, est aussi un « status »). */
let row: HTMLElement = document.body;
function announcement() {
  return within(row).findByRole("status");
}

function renderActions(role?: "owner" | "editor" | "viewer") {
  const view = render(
    <ToastProvider>
      <ul>
      <li>
        <a id="programme-p2" href="#p2">
          Voisin
        </a>
        <h2 id="liste-programmes" tabIndex={-1}>
          Liste
        </h2>
        <ProgramActions
          programId="p1"
          programName="BTS SIO"
          role={role}
          focusAfterDelete={["programme-p2", "liste-programmes"]}
        />
      </li>
      </ul>
    </ToastProvider>,
  );
  row = view.container;
  return view;
}

function trigger() {
  return screen.getByRole("button", { name: "Actions du projet BTS SIO" });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return screen.getByRole("menu", { name: "Actions du projet BTS SIO" });
}

describe("Menu « ⋮ » d'une ligne de projet", () => {
  it("devrait exposer un bouton icône de menu, fermé", () => {
    renderActions();
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Dupliquer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Supprimer/ })).not.toBeInTheDocument();
  });

  it("devrait ouvrir un menu avec Dupliquer et Supprimer", async () => {
    const user = userEvent.setup();
    renderActions();
    const menu = await openMenu(user);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Dupliquer", "Supprimer"]);
  });

  it("devrait s'ouvrir au clavier et rendre le focus au bouton sur Échap", async () => {
    const user = userEvent.setup();
    renderActions();
    trigger().focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Dupliquer" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("devrait dupliquer, annoncer le succès et rafraîchir la liste", async () => {
    duplicate.mockResolvedValue({ ok: true, data: { id: "p3" } });
    const user = userEvent.setup();
    renderActions();
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Dupliquer" }));
    expect(duplicate).toHaveBeenCalledWith("p1");
    expect(await announcement()).toHaveTextContent("Copie de « BTS SIO » créée en tête de liste.");
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("devrait annoncer l'échec de la duplication", async () => {
    duplicate.mockResolvedValue({ ok: false, error: "Projet introuvable." });
    const user = userEvent.setup();
    renderActions();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Dupliquer" }));
    expect(await announcement()).toHaveTextContent("Projet introuvable.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("devrait annoncer une coupure réseau pendant la duplication", async () => {
    duplicate.mockRejectedValue(new Error("fetch failed"));
    const user = userEvent.setup();
    renderActions();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Dupliquer" }));
    expect(await announcement()).toHaveTextContent("La connexion a été interrompue. Réessayez.");
  });

  it("devrait ouvrir la confirmation avec recopie du nom, et rendre le focus au bouton en annulant", async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Supprimer" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer le projet ?" });
    expect(dialog).toHaveAccessibleDescription(
      "Supprimer « BTS SIO », ses sujets et ses diaporamas ? Vous pourrez annuler pendant quelques secondes.",
    );
    const input = within(dialog).getByLabelText("Recopiez « BTS SIO » pour confirmer");
    await waitFor(() => expect(input).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Supprimer définitivement" })).toHaveAttribute("aria-disabled", "true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(remove).not.toHaveBeenCalled();
  });

  it("devrait bloquer la suppression tant que le nom recopié est faux", async () => {
    const user = userEvent.setup();
    renderActions();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Supprimer" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer le projet ?" });
    await user.type(within(dialog).getByLabelText("Recopiez « BTS SIO » pour confirmer"), "BTS{Enter}");
    expect(await within(dialog).findByText("Recopiez exactement « BTS SIO » pour confirmer.")).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it("devrait supprimer puis placer le focus sur le projet voisin", async () => {
    remove.mockResolvedValue({ ok: true, data: { undoUntil: "2026-10-07T08:00:30.000Z" } });
    const user = userEvent.setup();
    renderActions();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Supprimer" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer le projet ?" });
    await user.type(within(dialog).getByLabelText("Recopiez « BTS SIO » pour confirmer"), "BTS SIO");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer définitivement" }));
    expect(remove).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // jsdom ne calcule pas de boîtes : focusLater exige getClientRects() non vide.
    const neighbour = screen.getByRole("link", { name: "Voisin" });
    neighbour.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
    await waitFor(() => expect(neighbour).toHaveFocus(), { timeout: 2000 });
  });

  it("devrait garder la confirmation ouverte et afficher l'erreur si la suppression échoue", async () => {
    remove.mockResolvedValue({ ok: false, error: "Projet introuvable." });
    const user = userEvent.setup();
    renderActions();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Supprimer" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer le projet ?" });
    await user.type(within(dialog).getByLabelText("Recopiez « BTS SIO » pour confirmer"), "BTS SIO");
    await act(async () => {
      await user.click(within(dialog).getByRole("button", { name: "Supprimer définitivement" }));
    });
    expect(await within(dialog).findByText("Projet introuvable.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Supprimer le projet ?" })).toBeInTheDocument();
  });

  it("devrait masquer « Supprimer » pour un éditeur ou un lecteur (réservé au propriétaire)", async () => {
    const user = userEvent.setup();
    renderActions("editor");
    const menu = await openMenu(user);
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Dupliquer"]);
  });

  it("devrait proposer d'annuler la suppression pendant quelques secondes, puis restaurer", async () => {
    remove.mockResolvedValue({ ok: true, data: { undoUntil: "2026-10-07T08:00:30.000Z" } });
    restore.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderActions("owner");
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Supprimer" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer le projet ?" });
    await user.type(within(dialog).getByLabelText("Recopiez « BTS SIO » pour confirmer"), "BTS SIO");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer définitivement" }));

    expect(await screen.findByText("Projet supprimé.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Annuler la suppression du projet BTS SIO" }));
    expect(restore).toHaveBeenCalledWith("p1");
    expect(await screen.findByText("Projet restauré.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait afficher l'échec de l'annulation (délai dépassé)", async () => {
    remove.mockResolvedValue({ ok: true, data: { undoUntil: "2026-10-07T08:00:30.000Z" } });
    restore.mockResolvedValue({ ok: false, error: "Ce projet est introuvable." });
    const user = userEvent.setup();
    renderActions();
    await user.click(within(await openMenu(user)).getByRole("menuitem", { name: "Supprimer" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer le projet ?" });
    await user.type(within(dialog).getByLabelText("Recopiez « BTS SIO » pour confirmer"), "BTS SIO");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer définitivement" }));
    await user.click(await screen.findByRole("button", { name: "Annuler la suppression du projet BTS SIO" }));
    expect(await screen.findByText("Annulation impossible.")).toBeInTheDocument();
    expect(screen.getByText("Ce projet est introuvable.")).toBeInTheDocument();
  });
});
