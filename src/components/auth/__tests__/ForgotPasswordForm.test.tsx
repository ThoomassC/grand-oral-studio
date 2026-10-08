import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const requestPasswordReset = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args) },
}));

const { ForgotPasswordForm } = await import("@/components/auth/ForgotPasswordForm");

afterEach(() => {
  cleanup();
  requestPasswordReset.mockReset();
});

async function submitWith(email: string) {
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Adresse e-mail"), email);
  await user.click(screen.getByRole("button", { name: "Recevoir le lien" }));
}

describe("ForgotPasswordForm", () => {
  it("devrait refuser une adresse invalide sans appeler le serveur", async () => {
    await submitWith("pas-une-adresse");
    expect(await screen.findByText("Adresse e-mail invalide.")).toBeInTheDocument();
    expect(screen.getByLabelText("Adresse e-mail")).toHaveAttribute("aria-invalid", "true");
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("devrait demander le lien vers la page de réinitialisation de l'app", async () => {
    requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
    await submitWith("  eleve@lycee-exemple.fr ");
    expect(requestPasswordReset).toHaveBeenCalledWith({
      email: "eleve@lycee-exemple.fr",
      redirectTo: "/reinitialiser-mot-de-passe",
    });
  });

  it("devrait confirmer de façon neutre, sans révéler si un compte existe", async () => {
    requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null });
    await submitWith("eleve@lycee-exemple.fr");
    const status = await screen.findByText(/Si un compte existe avec l'adresse eleve@lycee-exemple\.fr/);
    expect(status).toBeInTheDocument();
    expect(status.textContent).toMatch(/une heure/);
  });

  it("devrait signaler la limitation de débit", async () => {
    requestPasswordReset.mockResolvedValue({ data: null, error: { status: 429, code: undefined } });
    await submitWith("eleve@lycee-exemple.fr");
    expect(await screen.findByText(/Trop de demandes/)).toBeInTheDocument();
    expect(screen.queryByText(/Si un compte existe/)).not.toBeInTheDocument();
  });

  it("devrait signaler une coupure réseau sans perdre la saisie", async () => {
    requestPasswordReset.mockRejectedValue(new TypeError("Failed to fetch"));
    await submitWith("eleve@lycee-exemple.fr");
    expect(await screen.findByText("La connexion au serveur a été interrompue. Réessayez.")).toBeInTheDocument();
    expect(screen.getByLabelText("Adresse e-mail")).toHaveValue("eleve@lycee-exemple.fr");
  });
});
