import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const social = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
  signIn: { social: (...args: unknown[]) => social(...args), email: vi.fn() },
  signUp: { email: vi.fn() },
}));

const { AuthForm } = await import("@/components/auth/AuthForm");

const MESSAGE = "La connexion avec Google a été annulée ou refusée. Réessayez.";

afterEach(() => {
  cleanup();
  social.mockReset();
});

describe("AuthForm — erreur de retour OAuth", () => {
  it("ne devrait pas figer l'erreur dans le HTML serveur (une région live n'annonce que les changements)", () => {
    const html = renderToString(<AuthForm mode="signin" next="/programmes" google="enabled" initialError={MESSAGE} />);
    expect(html).not.toContain(MESSAGE);
  });

  it("devrait injecter l'erreur dans la région d'alerte après le montage", async () => {
    render(<AuthForm mode="signin" next="/programmes" google="enabled" initialError={MESSAGE} />);
    const alerts = await screen.findAllByRole("alert");
    // Encart au rendu de Feedback d'Opale : titre « Erreur » puis le message.
    expect(alerts.some((a) => a.textContent === `Erreur${MESSAGE}`)).toBe(true);
  });

  it("devrait effacer l'erreur initiale quand on relance Google", async () => {
    social.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<AuthForm mode="signin" next="/programmes" google="enabled" initialError={MESSAGE} />);
    await screen.findByText(MESSAGE);

    await user.click(screen.getByRole("button", { name: "Continuer avec Google" }));

    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((s) => within(s).queryByText("Redirection vers Google…"))).toBe(true);
  });
});
