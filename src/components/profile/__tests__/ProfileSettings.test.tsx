import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ authClient: { changePassword: vi.fn() } }));

const { ProfileSettings } = await import("@/components/profile/ProfileSettings");

const EMAIL = "alice@example.test";
const updateNameAction = vi.fn();
const deleteAccountAction = vi.fn();
const props = {
  name: "Alice",
  email: EMAIL,
  hasPassword: true,
  canResetPassword: true,
  updateNameAction,
  deleteAccountAction,
};

afterEach(() => {
  cleanup();
  updateNameAction.mockReset();
  deleteAccountAction.mockReset();
});

describe("Paramètres du profil", () => {
  it("permet d'ouvrir et enregistrer le nom au clavier, puis rend le focus aux paramètres", async () => {
    updateNameAction.mockResolvedValue({ ok: true, data: { name: "Alice Martin" } });
    const user = userEvent.setup();
    render(<ProfileSettings {...props} />);
    await user.tab();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("menu", { name: "Paramètres du profil" });
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Modifier le nom" });
    const field = within(dialog).getByRole("textbox", { name: "Nom" });
    await waitFor(() => expect(field).toHaveFocus());
    await user.clear(field);
    await user.type(field, "  Alice Martin  ");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer le nom" }));
    expect(updateNameAction).toHaveBeenCalledWith({ name: "Alice Martin" });
    await within(dialog).findByText("Nom enregistré.");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Paramètres" })).toHaveFocus());
  });

  it("ouvre le formulaire de mot de passe depuis le menu", async () => {
    const user = userEvent.setup();
    render(<ProfileSettings {...props} />);
    await user.click(screen.getByRole("button", { name: "Paramètres" }));
    await user.click(screen.getByRole("menuitem", { name: "Modifier le mot de passe" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier le mot de passe" });
    await waitFor(() => expect(within(dialog).getByLabelText("Mot de passe actuel")).toHaveFocus());
    expect(within(dialog).getByLabelText("Nouveau mot de passe")).toHaveAttribute("type", "password");
    expect(dialog).toHaveAccessibleDescription("Vos autres sessions seront déconnectées.");
  });

  it.each([true, false])("respecte le compte Google et la disponibilité du rétablissement par e-mail : %s", async (canResetPassword) => {
    const user = userEvent.setup();
    render(<ProfileSettings {...props} hasPassword={false} canResetPassword={canResetPassword} />);
    await user.click(screen.getByRole("button", { name: "Paramètres" }));
    await user.click(screen.getByRole("menuitem", { name: "Modifier le mot de passe" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier le mot de passe" });
    expect(within(dialog).queryByLabelText("Mot de passe actuel")).not.toBeInTheDocument();
    const reset = within(dialog).queryByRole("link", { name: "Définir un mot de passe" });
    if (canResetPassword) expect(reset).toHaveAttribute("href", "/mot-de-passe-oublie");
    else expect(reset).not.toBeInTheDocument();
  });

  it("ouvre directement la confirmation de suppression, conserve la recopie de l'e-mail et permet d'annuler", async () => {
    const user = userEvent.setup();
    render(<ProfileSettings {...props} />);
    await user.click(screen.getByRole("button", { name: "Paramètres" }));
    await user.click(screen.getByRole("menuitem", { name: "Supprimer votre compte" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer votre compte ?" });
    expect(dialog).toHaveAccessibleDescription(/Votre compte, vos projets.*Cette action est définitive\./);
    const confirm = within(dialog).getByRole("button", { name: "Supprimer définitivement" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await user.click(confirm);
    expect(deleteAccountAction).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(`Recopiez « ${EMAIL} » pour confirmer`), "alice@");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Paramètres" })).toHaveFocus());
    expect(deleteAccountAction).not.toHaveBeenCalled();
  });

  it("ferme la confirmation après une suppression réussie", async () => {
    deleteAccountAction.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<ProfileSettings {...props} />);
    await user.click(screen.getByRole("button", { name: "Paramètres" }));
    await user.click(screen.getByRole("menuitem", { name: "Supprimer votre compte" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer votre compte ?" });
    await user.type(within(dialog).getByLabelText(`Recopiez « ${EMAIL} » pour confirmer`), EMAIL);
    await user.click(within(dialog).getByRole("button", { name: "Supprimer définitivement" }));
    expect(deleteAccountAction).toHaveBeenCalledWith({ confirmEmail: EMAIL });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
