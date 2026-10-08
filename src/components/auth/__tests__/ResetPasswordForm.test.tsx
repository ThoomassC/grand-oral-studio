import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const resetPassword = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { resetPassword: (...args: unknown[]) => resetPassword(...args) },
}));

const { ResetPasswordForm } = await import("@/components/auth/ResetPasswordForm");

afterEach(() => {
  cleanup();
  resetPassword.mockReset();
});

async function submitWith(password: string) {
  const user = userEvent.setup();
  render(<ResetPasswordForm token="jeton123abc" />);
  await user.type(screen.getByLabelText("Nouveau mot de passe"), password);
  await user.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
}

describe("ResetPasswordForm", () => {
  it("devrait refuser un mot de passe trop court sans appeler le serveur", async () => {
    await submitWith("court");
    expect(await screen.findByText(/au moins 10 caractères/)).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("devrait enregistrer le mot de passe avec le jeton puis proposer de se connecter", async () => {
    resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    await submitWith("nouveau-mdp-1");
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: "nouveau-mdp-1", token: "jeton123abc" });
    expect(await screen.findByText(/Mot de passe enregistré/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/connexion");
    expect(screen.queryByLabelText("Nouveau mot de passe")).not.toBeInTheDocument();
  });

  it("devrait proposer un nouveau lien quand le jeton a expiré ou a déjà servi", async () => {
    resetPassword.mockResolvedValue({ data: null, error: { status: 400, code: "INVALID_TOKEN" } });
    await submitWith("nouveau-mdp-1");
    expect(await screen.findByText(/Ce lien n'est plus valide/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Demander un nouveau lien" })).toHaveAttribute("href", "/mot-de-passe-oublie");
  });
});
