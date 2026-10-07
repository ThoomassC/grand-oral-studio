import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { DeleteAccountForm } = await import("@/components/profile/DeleteAccountForm");

afterEach(() => {
  cleanup();
  push.mockReset();
});

const EMAIL = "eleve@lycee-exemple.fr";

async function openAndType(text: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
  const dialog = screen.getByRole("dialog", { name: "Supprimer votre compte ?" });
  await user.type(within(dialog).getByLabelText(`Recopiez « ${EMAIL} » pour confirmer`), text);
  await user.click(within(dialog).getByRole("button", { name: "Supprimer définitivement" }));
  return dialog;
}

describe("DeleteAccountForm", () => {
  it("ne devrait rien supprimer tant que l'adresse n'est pas recopiée exactement", async () => {
    const action = vi.fn();
    render(<DeleteAccountForm email={EMAIL} action={action} />);
    const dialog = await openAndType("eleve@");
    expect(action).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Supprimer définitivement" })).toHaveAttribute("aria-disabled", "true");
  });

  it("devrait afficher l'erreur du serveur (ex. session trop ancienne) sans fermer la modale", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Par sécurité, la suppression demande une connexion récente." });
    render(<DeleteAccountForm email={EMAIL} action={action} />);
    const dialog = await openAndType(EMAIL);
    expect(action).toHaveBeenCalledWith({ confirmEmail: EMAIL });
    expect(await within(dialog).findByText(/connexion récente/)).toBeInTheDocument();
  });

  it("devrait revenir à l'accueil une fois le compte supprimé", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: null });
    render(<DeleteAccountForm email={EMAIL} action={action} />);
    await openAndType(EMAIL);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("devrait prévenir que les projets partagés disparaîtront aussi pour les collègues", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DeleteAccountForm email={EMAIL} action={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
    expect(screen.getByRole("dialog")).not.toHaveTextContent("pour vos collègues aussi");
    rerender(<DeleteAccountForm email={EMAIL} action={vi.fn()} sharesProjects />);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Les projets que vous partagez seront supprimés pour vos collègues aussi.",
    );
  });
});
