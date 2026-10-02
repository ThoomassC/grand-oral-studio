import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Slide } from "@/domain/schemas";

const push = vi.fn();
const replace = vi.fn();
const updateDeckSlide = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/squelettes/d1", useRouter: () => ({ push, replace }) }));
vi.mock("@/server/actions/decks", () => ({ updateDeckSlide: (...args: unknown[]) => updateDeckSlide(...args) }));

const { SlideEditor } = await import("@/components/decks/SlideEditor");
const { UnsavedChangesBanner, UnsavedChangesProvider } = await import("@/components/layout/UnsavedChanges");
const { GuardedLink } = await import("@/components/layout/GuardedLink");

afterEach(async () => {
  cleanup();
  // Le démontage retire la sentinelle d'historique de la garde (`history.back()`, asynchrone).
  await new Promise((resolve) => setTimeout(resolve, 20));
  push.mockReset();
  replace.mockReset();
  updateDeckSlide.mockReset();
  vi.restoreAllMocks();
});

const SLIDE: Slide = {
  layout: "content",
  sectionId: "s1",
  title: "Contexte",
  subtitle: "",
  bullets: ["Première puce"],
  notes: "",
};

function renderEditor() {
  return render(
    <UnsavedChangesProvider>
      <GuardedLink href="/projets/p1/squelettes">Squelettes</GuardedLink>
      <SlideEditor deckId="d1" index={1} slide={SLIDE} expectedUpdatedAt="2026-01-01T00:00:00.000Z" onSaved={vi.fn()} onCancel={vi.fn()} />
      <UnsavedChangesBanner />
    </UnsavedChangesProvider>,
  );
}

const leave = () => screen.queryByRole("dialog", { name: "Quitter sans enregistrer ?" });

describe("SlideEditor — garde « modifications non enregistrées »", () => {
  it("ne devrait rien retenir tant que la diapo n'est pas modifiée", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    renderEditor();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("devrait demander confirmation en quittant la page avec une diapo modifiée", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByRole("textbox", { name: "Titre" }), " modifié");
    await user.click(screen.getByRole("link", { name: "Squelettes" }));
    expect(leave()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(replace).toHaveBeenCalledWith("/projets/p1/squelettes");
  });

  it("devrait armer l'avertissement natif (rechargement, fermeture) avec une diapo modifiée", async () => {
    const user = userEvent.setup();
    renderEditor();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await user.type(screen.getByRole("textbox", { name: "Titre" }), " modifié");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("devrait lever la garde quand la saisie revient à l'état enregistré", async () => {
    const user = userEvent.setup();
    renderEditor();
    const title = screen.getByRole("textbox", { name: "Titre" });
    await user.type(title, "!");
    await user.type(title, "{Backspace}");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    expect(leave()).not.toBeInTheDocument();
  });
});
