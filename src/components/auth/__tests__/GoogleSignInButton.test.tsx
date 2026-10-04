import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const social = vi.fn();
vi.mock("@/lib/auth-client", () => ({ signIn: { social: (...args: unknown[]) => social(...args) } }));

const { GoogleSignInButton } = await import("@/components/auth/GoogleSignInButton");

afterEach(() => {
  cleanup();
  social.mockReset();
});

describe("GoogleSignInButton", () => {
  it("devrait lancer la connexion Google en conservant la destination ?next=", async () => {
    social.mockResolvedValue({ data: { url: "https://accounts.google.com/x", redirect: true }, error: null });
    const user = userEvent.setup();
    render(<GoogleSignInButton next="/projets/abc?x=1" />);

    await user.click(screen.getByRole("button", { name: "Continuer avec Google" }));

    expect(social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/projets/abc?x=1",
      newUserCallbackURL: "/projets/abc?x=1",
      errorCallbackURL: "/connexion?next=%2Fprojets%2Fabc%3Fx%3D1",
    });
  });

  it("devrait afficher une erreur si la demande échoue", async () => {
    social.mockResolvedValue({ data: null, error: { status: 500, message: "boom" } });
    const user = userEvent.setup();
    render(<GoogleSignInButton next="/projets" />);

    await user.click(screen.getByRole("button", { name: "Continuer avec Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("La connexion avec Google n'a pas pu démarrer. Réessayez.");
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuer avec Google" })).not.toHaveAttribute("aria-disabled");
  });

  it("devrait afficher une erreur si le réseau est coupé", async () => {
    social.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<GoogleSignInButton next="/projets" />);

    await user.click(screen.getByRole("button", { name: "Continuer avec Google" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("La connexion avec Google n'a pas pu démarrer. Réessayez.");
  });

  it("ne devrait rien lancer et expliquer quoi faire quand Google n'est pas configuré", async () => {
    const user = userEvent.setup();
    render(<GoogleSignInButton next="/projets" configured={false} />);

    const button = screen.getByRole("button", { name: "Continuer avec Google" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(/pas encore configurée/);
    await user.click(button);
    expect(social).not.toHaveBeenCalled();
  });
});
