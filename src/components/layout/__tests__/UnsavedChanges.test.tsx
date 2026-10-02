import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/charte", useRouter: () => ({ push, replace }) }));

const { UnsavedChangesBanner, UnsavedChangesProvider, useUnsavedChanges } = await import("@/components/layout/UnsavedChanges");

/** Laisse passer la traversée d'historique de jsdom (deux minuteries) et son `popstate`. */
const flushHistory = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

/** Simule « Précédent » du navigateur et attend l'événement `popstate`. */
async function pressBack() {
  window.history.back();
  await flushHistory();
}

afterEach(async () => {
  cleanup();
  await flushHistory();
  push.mockReset();
  replace.mockReset();
  vi.restoreAllMocks();
});

function Editor({ initialDirty = true }: { initialDirty?: boolean }) {
  const [dirty, setDirty] = useState(initialDirty);
  useUnsavedChanges(dirty);
  return (
    <>
      <input aria-label="Champ" />
      <button type="button" onClick={() => setDirty((d) => !d)}>
        {dirty ? "Enregistrer" : "Modifier"}
      </button>
    </>
  );
}

function renderGuard(initialDirty = true) {
  return render(
    <UnsavedChangesProvider>
      <Editor initialDirty={initialDirty} />
      <UnsavedChangesBanner />
    </UnsavedChangesProvider>,
  );
}

const modal = () => screen.queryByRole("dialog", { name: "Quitter sans enregistrer ?" });

describe("UnsavedChanges — « Précédent » du navigateur", () => {
  it("devrait empiler une seule entrée sentinelle (même URL) à la première modification", async () => {
    const before = window.history.length;
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    renderGuard(false);
    expect(pushState).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Modifier" }));
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]?.[2]).toBe(window.location.href);
    expect(window.history.length).toBe(before + 1);
  });

  it("devrait retenir « Précédent », rester sur la page et réarmer la garde", async () => {
    const user = userEvent.setup();
    renderGuard();
    const url = window.location.href;
    screen.getByRole("textbox", { name: "Champ" }).focus();
    await pressBack();
    expect(modal()).toBeInTheDocument();
    expect(window.location.href).toBe(url);

    await user.click(screen.getByRole("button", { name: "Rester sur la page" }));
    expect(modal()).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Champ" })).toHaveFocus());

    // Toujours gardé : un second « Précédent » redemande confirmation.
    await pressBack();
    expect(modal()).toBeInTheDocument();
  });

  it("devrait rejouer le retour en confirmant : sentinelle et page dépilées", async () => {
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderGuard();
    await pressBack();
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(go).toHaveBeenCalledWith(-2);
    expect(modal()).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("devrait retirer la sentinelle à l'enregistrement, sans ouvrir la confirmation", async () => {
    const back = vi.spyOn(window.history, "back");
    const user = userEvent.setup();
    renderGuard();
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(back).toHaveBeenCalledTimes(1);
    await flushHistory();
    expect(modal()).not.toBeInTheDocument();
  });

  it("devrait retirer la sentinelle au démontage de l'éditeur", async () => {
    const back = vi.spyOn(window.history, "back");
    renderGuard();
    cleanup();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("ne devrait rien retenir sans modification", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    renderGuard(false);
    // Un retour réel quitterait la page : on vérifie seulement qu'aucune garde n'est posée.
    expect(pushState).not.toHaveBeenCalled();
    expect(modal()).not.toBeInTheDocument();
  });
});
