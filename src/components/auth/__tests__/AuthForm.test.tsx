import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const social = vi.fn();
const signInEmail = vi.fn();
const signUpEmail = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
  signIn: { social: (...args: unknown[]) => social(...args), email: (...args: unknown[]) => signInEmail(...args) },
  signUp: { email: (...args: unknown[]) => signUpEmail(...args) },
}));

const { AuthForm } = await import("@/components/auth/AuthForm");

const MESSAGE = "La connexion avec Google a été annulée ou refusée. Réessayez.";

afterEach(() => {
  cleanup();
  social.mockReset();
  signInEmail.mockReset();
  signUpEmail.mockReset();
  replace.mockReset();
});

describe("AuthForm — erreur de retour OAuth", () => {
  it("ne devrait pas figer l'erreur dans le HTML serveur (une région live n'annonce que les changements)", () => {
    const html = renderToString(<AuthForm mode="signin" next="/projets" google="enabled" initialError={MESSAGE} />);
    expect(html).not.toContain(MESSAGE);
  });

  it("devrait injecter l'erreur dans la région d'alerte après le montage", async () => {
    render(<AuthForm mode="signin" next="/projets" google="enabled" initialError={MESSAGE} />);
    const alerts = await screen.findAllByRole("alert");
    // Encart au rendu de Feedback d'Opale : titre « Erreur » puis le message.
    expect(alerts.some((a) => a.textContent === `Erreur${MESSAGE}`)).toBe(true);
  });

  it("devrait effacer l'erreur initiale quand on relance Google", async () => {
    social.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<AuthForm mode="signin" next="/projets" google="enabled" initialError={MESSAGE} />);
    await screen.findByText(MESSAGE);

    await user.click(screen.getByRole("button", { name: "Continuer avec Google" }));

    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((s) => within(s).queryByText("Redirection vers Google…"))).toBe(true);
  });
});

describe("AuthForm — mot de passe oublié et vérification de l'adresse", () => {
  it("devrait proposer « Mot de passe oublié ? » à la connexion seulement", () => {
    render(<AuthForm mode="signin" next="/projets" google="hidden" />);
    expect(screen.getByRole("link", { name: "Mot de passe oublié ?" })).toHaveAttribute("href", "/mot-de-passe-oublie");
    cleanup();
    render(<AuthForm mode="signup" next="/projets" google="hidden" />);
    expect(screen.queryByRole("link", { name: "Mot de passe oublié ?" })).not.toBeInTheDocument();
  });

  it("devrait expliquer qu'il faut confirmer l'adresse quand la connexion répond EMAIL_NOT_VERIFIED", async () => {
    signInEmail.mockResolvedValue({ data: null, error: { status: 403, code: "EMAIL_NOT_VERIFIED" } });
    const user = userEvent.setup();
    render(<AuthForm mode="signin" next="/projets/abc" google="hidden" verifyEmail />);
    await user.type(screen.getByLabelText("Adresse e-mail"), "eleve@lycee-exemple.fr");
    await user.type(screen.getByLabelText("Mot de passe"), "mot-de-passe-1");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText(/Confirmez d'abord votre adresse e-mail/)).toBeInTheDocument();
    // Le lien de confirmation ramène à la connexion, qui poursuit vers la destination.
    expect(signInEmail).toHaveBeenCalledWith({
      email: "eleve@lycee-exemple.fr",
      password: "mot-de-passe-1",
      callbackURL: "/connexion?next=%2Fprojets%2Fabc",
    });
  });

  it("devrait annoncer l'e-mail de confirmation après l'inscription, sans révéler un compte existant", async () => {
    signUpEmail.mockResolvedValue({ data: { token: null, user: {} }, error: null });
    const user = userEvent.setup();
    render(<AuthForm mode="signup" next="/projets" google="hidden" verifyEmail />);
    await user.type(screen.getByLabelText("Nom"), "Alice");
    await user.type(screen.getByLabelText("Adresse e-mail"), "eleve@lycee-exemple.fr");
    await user.type(screen.getByLabelText("Mot de passe"), "mot-de-passe-1");
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));
    expect(await screen.findByText(/lien de confirmation envoyé à eleve@lycee-exemple\.fr/)).toBeInTheDocument();
    expect(screen.getByText(/Si vous aviez déjà un compte avec cette adresse, connectez-vous/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("ne devrait transmettre aucun callbackURL quand la vérification est inactive (comportement inchangé)", async () => {
    signInEmail.mockResolvedValue({ data: { token: "t" }, error: null });
    const user = userEvent.setup();
    render(<AuthForm mode="signin" next="/projets" google="hidden" />);
    await user.type(screen.getByLabelText("Adresse e-mail"), "eleve@lycee-exemple.fr");
    await user.type(screen.getByLabelText("Mot de passe"), "mot-de-passe-1");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(signInEmail).toHaveBeenCalledWith({ email: "eleve@lycee-exemple.fr", password: "mot-de-passe-1" });
    expect(replace).toHaveBeenCalledWith("/projets");
  });
});
