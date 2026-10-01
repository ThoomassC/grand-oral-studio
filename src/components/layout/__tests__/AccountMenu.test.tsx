import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
const signOut = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/auth-client", () => ({ signOut: (...args: unknown[]) => signOut(...args) }));

const { AccountMenu } = await import("@/components/layout/AccountMenu");

const USER = { name: "Alice Martin", email: "alice@example.test" };

afterEach(() => {
  cleanup();
  push.mockReset();
  refresh.mockReset();
  signOut.mockReset();
});

function trigger() {
  return screen.getByRole("button", { name: "Compte : alice@example.test" });
}

describe("AccountMenu", () => {
  it("devrait exposer un bouton de menu fermé, nommé par l'adresse du compte", () => {
    render(<AccountMenu {...USER} />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("devrait ouvrir un menu titré par le nom et l'e-mail, avec les deux actions", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...USER} />);
    await user.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    const group = within(menu).getByRole("group");
    expect(group).toHaveAccessibleName(/Alice Martin/);
    expect(group).toHaveAccessibleName(/alice@example\.test/);
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Informations du profil",
      "Se déconnecter",
    ]);
  });

  it("devrait se piloter au clavier : flèches, Entrée, Échap et retour du focus", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...USER} />);
    trigger().focus();
    await user.keyboard("{Enter}");
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(within(screen.getByRole("menu")).getAllByRole("menuitem")[0]).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/profil");
  });

  it("devrait se déconnecter depuis le menu, avec l'état en cours", async () => {
    let resolve: (v: { error: null }) => void = () => {};
    signOut.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<AccountMenu {...USER} />);
    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Se déconnecter" }));
    expect(signOut).toHaveBeenCalled();
    expect(await screen.findByRole("menuitem", { name: "Déconnexion…" })).toHaveAttribute("aria-disabled", "true");
    resolve({ error: null });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("devrait annoncer l'échec de la déconnexion", async () => {
    signOut.mockResolvedValue({ error: { message: "boom" } });
    const user = userEvent.setup();
    render(<AccountMenu {...USER} />);
    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Se déconnecter" }));
    expect(await screen.findByText("La déconnexion a échoué. Réessayez.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
