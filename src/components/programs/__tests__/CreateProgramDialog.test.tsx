import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const create = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/actions/programs", () => ({ createProgram: (...args: unknown[]) => create(...args) }));

const { CreateProgramDialog } = await import("@/components/programs/CreateProgramDialog");

afterEach(() => {
  cleanup();
  push.mockReset();
  create.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function trigger(name = "Nouveau projet") {
  return screen.getByRole("button", { name });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>, name?: string) {
  await user.click(trigger(name));
  return screen.findByRole("dialog", { name: "Nouveau projet" });
}

describe("Modale de création d'un projet", () => {
  it("devrait exposer un bouton fermé qui annonce une modale", () => {
    render(<CreateProgramDialog />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("devrait ouvrir la modale avec le formulaire et le focus sur le nom", async () => {
    const user = userEvent.setup();
    render(<CreateProgramDialog />);
    const dialog = await openDialog(user);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/charte neutre et un gabarit par défaut/);
    const name = within(dialog).getByLabelText("Nom du projet");
    await waitFor(() => expect(name).toHaveFocus());
    expect(within(dialog).getByLabelText(/^Description/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Créer le projet" })).toBeInTheDocument();
  });

  it("devrait se fermer sur Échap et rendre le focus au bouton", async () => {
    const user = userEvent.setup();
    render(<CreateProgramDialog />);
    await openDialog(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
    expect(create).not.toHaveBeenCalled();
  });

  it("devrait se fermer sur « Annuler », rendre le focus et repartir d'un formulaire vide", async () => {
    const user = userEvent.setup();
    render(<CreateProgramDialog />);
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Nom du projet"), "Brouillon");
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
    const again = await openDialog(user);
    expect(within(again).getByLabelText("Nom du projet")).toHaveValue("");
  });

  it("devrait refuser un nom trop court dans la modale, sans appeler le serveur", async () => {
    const user = userEvent.setup();
    render(<CreateProgramDialog />);
    const dialog = await openDialog(user);
    const name = within(dialog).getByLabelText("Nom du projet");
    await user.type(name, "A");
    await user.click(within(dialog).getByRole("button", { name: "Créer le projet" }));
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(name).toHaveAccessibleDescription("Le nom doit contenir entre 2 et 120 caractères.");
    expect(within(dialog).getByText(/1 champ est à corriger avant de créer le projet/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await waitFor(() => expect(name).toHaveFocus());
  });

  it("devrait afficher l'erreur du serveur dans la modale, saisie conservée", async () => {
    create.mockResolvedValue({ ok: false, error: "Trop de projets créés aujourd'hui." });
    const user = userEvent.setup();
    render(<CreateProgramDialog />);
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Nom du projet"), "Master 2027");
    await user.click(within(dialog).getByRole("button", { name: "Créer le projet" }));
    expect(await within(dialog).findByText("Trop de projets créés aujourd'hui.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Nouveau projet" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nom du projet")).toHaveValue("Master 2027");
    expect(push).not.toHaveBeenCalled();
  });

  it("devrait créer le projet puis ouvrir sa page", async () => {
    create.mockResolvedValue({ ok: true, data: { id: "p42" } });
    const user = userEvent.setup();
    render(<CreateProgramDialog />);
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Nom du projet"), "  Master Management 2027 ");
    await user.type(within(dialog).getByLabelText(/^Description/), "Grand oral");
    await user.click(within(dialog).getByRole("button", { name: "Créer le projet" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Master Management 2027", description: "Grand oral" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projets/p42"));
    expect(await within(dialog).findByText("Projet créé. Ouverture…")).toBeInTheDocument();
  });

  it("ne devrait pas se fermer sur Échap pendant la création", async () => {
    const pending = deferred<{ ok: false; error: string }>();
    create.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<CreateProgramDialog />);
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Nom du projet"), "Master 2027");
    await user.click(within(dialog).getByRole("button", { name: "Créer le projet" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Nouveau projet" })).toBeInTheDocument();
    pending.resolve({ ok: false, error: "Échec." });
    expect(await within(dialog).findByText("Échec.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("devrait accepter un autre libellé de déclencheur (état vide)", async () => {
    const user = userEvent.setup();
    render(<CreateProgramDialog label="Créer mon premier projet" />);
    const dialog = await openDialog(user, "Créer mon premier projet");
    expect(dialog).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger("Créer mon premier projet")).toHaveFocus());
  });
});
