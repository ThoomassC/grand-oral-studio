import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_COMPLETION_MS, AUTH_TRANSITION_MS } from "../auth-motion";

const router = { push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
const signOut = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ signOut: (...args: unknown[]) => signOut(...args) }));
const { useSignOut } = await import("../useSignOut");

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

function deferred() {
  let resolve!: (value: { error: null }) => void;
  const promise = new Promise<{ error: null }>((done) => { resolve = done; });
  signOut.mockReturnValue(promise);
  return resolve;
}

describe("useSignOut", () => {
  it("affiche la transition puis navigue une seule fois après confirmation et remplissage final", async () => {
    signOut.mockResolvedValue({ error: null });
    const { result } = renderHook(useSignOut);
    await act(async () => { result.current.signOut(); result.current.signOut(); });
    expect(signOut).toHaveBeenCalledOnce();
    expect(result.current.pending).toBe(true);
    expect(router.prefetch).toHaveBeenCalledExactlyOnceWith("/");
    await act(() => vi.advanceTimersByTimeAsync(AUTH_TRANSITION_MS - AUTH_COMPLETION_MS));
    expect(result.current.complete).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(AUTH_COMPLETION_MS));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/");
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("attend une déconnexion lente sans quitter la page ni rejouer toute l’animation", async () => {
    const resolve = deferred();
    const { result } = renderHook(useSignOut);
    act(() => result.current.signOut());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(router.push).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(true);
    await act(async () => resolve({ error: null }));
    expect(result.current.complete).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(AUTH_COMPLETION_MS));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/");
  });

  it.each(["système", "site"])("supprime le délai visuel en mouvement réduit (%s), en attendant le serveur", async (preference) => {
    if (preference === "système") vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    else document.documentElement.dataset.motion = "reduced";
    const resolve = deferred();
    const { result } = renderHook(useSignOut);
    act(() => result.current.signOut());
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => resolve({ error: null }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["refus", "réseau"])("rend la main en cas d’échec (%s) et permet de réessayer", async (failure) => {
    if (failure === "refus") signOut.mockResolvedValue({ error: { message: "refus" } });
    else signOut.mockRejectedValue(new Error("réseau"));
    const { result } = renderHook(useSignOut);
    await act(async () => result.current.signOut());
    expect(result.current.failed).toBe(true);
    expect(result.current.pending).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    document.documentElement.dataset.motion = "reduced";
    signOut.mockResolvedValue({ error: null });
    await act(async () => result.current.signOut());
    expect(result.current.failed).toBe(false);
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("annule les délais et ne navigue plus après démontage", async () => {
    signOut.mockResolvedValue({ error: null });
    const { result, unmount } = renderHook(useSignOut);
    await act(async () => result.current.signOut());
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(AUTH_TRANSITION_MS));
    expect(router.push).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
