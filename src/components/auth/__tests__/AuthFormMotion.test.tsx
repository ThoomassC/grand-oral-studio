import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_BUTTON_PENDING_MS, AUTH_BUTTON_SUCCESS_MS } from "../auth-motion";

const router = { replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
const signInEmail = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ signIn: { email: (...args: unknown[]) => signInEmail(...args) }, signUp: {} }));
const { AuthForm } = await import("../AuthForm");

type AuthResult = { data: { token: string } | null; error: { status: number; code: string } | null };
const SUCCESS: AuthResult = { data: { token: "session-test" }, error: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  delete document.documentElement.dataset.motion;
});

function login() {
  const view = render(<AuthForm mode="signin" next="/configuration-ia?x=1" google="hidden" appearance="studio" />);
  fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "eleve@example.test" } });
  fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "MotDePasse-E2E-2026" } });
  const button = screen.getByRole("button", { name: "Se connecter" });
  button.focus();
  return { ...view, button, form: button.closest("form")! };
}

function deferResponse() {
  let resolve!: (value: AuthResult) => void;
  signInEmail.mockReturnValue(new Promise<AuthResult>((done) => { resolve = done; }));
  return resolve;
}

describe("AuthForm — retour animé du bouton", () => {
  it("attend le serveur, confirme la session puis navigue sans nouvelle soumission ni perte de focus", async () => {
    const resolve = deferResponse();
    const { form, button } = login();
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(signInEmail).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Connexion…" })).toBe(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    await act(() => vi.advanceTimersByTimeAsync(AUTH_BUTTON_PENDING_MS - 1));
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => resolve(SUCCESS));
    expect(screen.queryByRole("button", { name: "Connecté" })).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("button", { name: "Connecté" })).toBe(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toHaveFocus();
    expect(screen.getByText("Connexion réussie.")).toHaveAttribute("role", "status");
    fireEvent.submit(form);
    expect(signInEmail).toHaveBeenCalledOnce();
    expect(router.prefetch).toHaveBeenCalledExactlyOnceWith("/connexion/chargement?next=%2Fconfiguration-ia%3Fx%3D1");
    await act(() => vi.advanceTimersByTimeAsync(AUTH_BUTTON_SUCCESS_MS - 1));
    expect(router.replace).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/connexion/chargement?next=%2Fconfiguration-ia%3Fx%3D1");
  });

  it("ne rejoue pas le début de l'animation après une réponse lente", async () => {
    const resolve = deferResponse();
    const { form } = login();
    await act(async () => fireEvent.submit(form));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole("button", { name: "Connexion…" })).toBeInTheDocument();
    await act(async () => resolve(SUCCESS));
    expect(screen.getByRole("button", { name: "Connecté" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(AUTH_BUTTON_SUCCESS_MS));
    expect(router.replace).toHaveBeenCalledOnce();
  });

  it.each(["refus", "réseau"])("revient au repos après un échec (%s), conserve la saisie et permet de réessayer", async (failure) => {
    if (failure === "refus") signInEmail.mockResolvedValue({ data: null, error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" } });
    else signInEmail.mockRejectedValue(new TypeError("Failed to fetch"));
    const { form, button } = login();
    await act(async () => fireEvent.submit(form));
    expect(screen.getByRole("button", { name: "Se connecter" })).toBe(button);
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: "Connecté" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Adresse e-mail")).toHaveValue("eleve@example.test");
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("MotDePasse-E2E-2026");
    expect(router.replace).not.toHaveBeenCalled();
    document.documentElement.dataset.motion = "reduced";
    signInEmail.mockResolvedValue(SUCCESS);
    await act(async () => fireEvent.submit(form));
    expect(signInEmail).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledOnce();
  });

  it.each(["système", "site"])("supprime les délais en mouvement réduit (%s), en attendant la vraie réponse", async (preference) => {
    if (preference === "système") vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    else document.documentElement.dataset.motion = "reduced";
    const resolve = deferResponse();
    const { form } = login();
    await act(async () => fireEvent.submit(form));
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => resolve(SUCCESS));
    expect(router.replace).toHaveBeenCalledOnce();
  });

  it("annule l'attente et la navigation quand on quitte le formulaire", async () => {
    signInEmail.mockResolvedValue(SUCCESS);
    const { form, unmount } = login();
    await act(async () => fireEvent.submit(form));
    await act(() => vi.advanceTimersByTimeAsync(AUTH_BUTTON_PENDING_MS));
    expect(screen.getByRole("button", { name: "Connecté" })).toBeInTheDocument();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(AUTH_BUTTON_SUCCESS_MS));
    expect(router.replace).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
