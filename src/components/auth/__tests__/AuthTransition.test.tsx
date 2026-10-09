import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { AuthTransition, AUTH_TRANSITION_MS } = await import("../AuthTransition");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete document.documentElement.dataset.motion;
});

describe("AuthTransition", () => {
  it("précharge la destination et laisse jouer la signature avant de naviguer une seule fois", () => {
    render(<AuthTransition next="/configuration-ia?x=1#contenu" />);
    expect(router.prefetch).toHaveBeenCalledWith("/configuration-ia?x=1#contenu");
    expect(screen.getByRole("status")).toHaveTextContent("Ouverture de votre espace…");
    expect(screen.getByRole("link", { name: "Accéder à mon espace" })).toHaveAttribute("href", "/configuration-ia?x=1#contenu");
    act(() => vi.advanceTimersByTime(AUTH_TRANSITION_MS - 1));
    expect(router.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/configuration-ia?x=1#contenu");
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it.each(["système", "réglage du site"])("n'ajoute aucun délai avec mouvement réduit (%s)", (preference) => {
    if (preference === "système") vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    else document.documentElement.dataset.motion = "reduced";
    render(<AuthTransition next="/projets" />);
    act(() => vi.advanceTimersByTime(0));
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/projets");
  });

  it("annule la navigation automatique si la transition est démontée", () => {
    const { unmount } = render(<AuthTransition next="/projets" />);
    unmount();
    act(() => vi.advanceTimersByTime(AUTH_TRANSITION_MS));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("ne retourne pas vers une URL externe ou une entrée d'authentification", () => {
    render(<AuthTransition next="/connexion/chargement?next=//evil.example" />);
    expect(screen.getByRole("link", { name: "Accéder à mon espace" })).toHaveAttribute("href", "/projets");
    act(() => vi.advanceTimersByTime(AUTH_TRANSITION_MS));
    expect(router.replace).toHaveBeenCalledWith("/projets");
  });
});
