import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1", useRouter: () => ({ push: vi.fn() }) }));
const reorderThemes = vi.fn();
vi.mock("@/server/actions/themes", () => ({
  addTheme: vi.fn(),
  deleteTheme: vi.fn(),
  reorderThemes: (...args: unknown[]) => reorderThemes(...args),
  updateTheme: vi.fn(),
  importThemes: vi.fn(),
}));

const { ThemeManager } = await import("@/components/themes/ThemeManager");
const { UnsavedChangesBanner, UnsavedChangesProvider } = await import("@/components/layout/UnsavedChanges");

afterEach(async () => {
  cleanup();
  reorderThemes.mockReset();
  // Laisse jsdom traiter le retrait de l'entrée sentinelle d'historique.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
});

describe("Gestionnaire de thèmes (sous le bloc d'import)", () => {
  it("ne devrait plus renvoyer vers la charte ni vers le gabarit", () => {
    render(<ThemeManager programId="p1" themes={[]} />);
    expect(screen.queryByRole("link", { name: /charte d'une présentation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gabarit avec un prompt/ })).not.toBeInTheDocument();
  });

  it("devrait garder la saisie manuelle à un clic, en secondaire", async () => {
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    expect(screen.getByText(/Importez votre sujet ci-dessus/)).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Ajouter un thème" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    await user.click(add);
    expect(screen.getByRole("heading", { name: "Nouveau thème" })).toBeInTheDocument();
  });

  it("devrait garder l'import de liste existant", async () => {
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    const trigger = screen.getByRole("button", { name: "Importer une liste" });
    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "Importer des thèmes" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});

const THEMES = ["Alpha", "Bravo", "Charlie"].map((name) => ({
  id: name.toLowerCase(),
  name,
  description: "",
  keywords: [],
  hasSkeleton: false,
  finalDeckCount: 0,
}));

/** Une requête d'enregistrement d'ordre que le test termine quand il veut. */
function deferred() {
  let resolve: (value: { ok: true; data: null }) => void = () => {};
  const promise = new Promise<{ ok: true; data: null }>((r) => {
    resolve = r;
  });
  return { promise, resolve: () => resolve({ ok: true, data: null }) };
}

function renderManager() {
  return render(
    <UnsavedChangesProvider>
      <ThemeManager programId="p1" themes={THEMES} />
      <UnsavedChangesBanner />
    </UnsavedChangesProvider>,
  );
}

function unloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("Gestionnaire de thèmes — enregistrement de l'ordre", () => {
  it("devrait armer la garde « modifications non enregistrées » tant que l'ordre s'enregistre, puis annoncer « Ordre enregistré. »", async () => {
    const request = deferred();
    reorderThemes.mockReturnValueOnce(request.promise);
    const user = userEvent.setup();
    renderManager();
    expect(unloadPrevented()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Descendre Alpha" }));
    // L'annonce du déplacement est immédiate ; l'enregistrement est en cours.
    expect(screen.getByText("« Alpha » déplacé en position 2 sur 3.")).toBeInTheDocument();
    expect(screen.queryByText("Ordre enregistré.")).not.toBeInTheDocument();
    expect(unloadPrevented()).toBe(true);

    await act(async () => request.resolve());
    expect(await screen.findByText("Ordre enregistré.")).toBeInTheDocument();
    expect(screen.getByText("Ordre enregistré.").closest("[role=status]")).not.toBeNull();
    expect(unloadPrevented()).toBe(false);
  });

  it("devrait enregistrer le DERNIER ordre après des déplacements rapides, sans requêtes croisées", async () => {
    const first = deferred();
    reorderThemes.mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole("button", { name: "Descendre Alpha" }));
    await user.click(screen.getByRole("button", { name: "Monter Charlie" }));
    await user.click(screen.getByRole("button", { name: "Monter Charlie" }));
    // Une seule requête à la fois : la suivante attend la fin de la première.
    expect(reorderThemes).toHaveBeenCalledTimes(1);
    expect(reorderThemes).toHaveBeenLastCalledWith("p1", ["bravo", "alpha", "charlie"]);
    expect(unloadPrevented()).toBe(true);

    await act(async () => first.resolve());
    await waitFor(() => expect(reorderThemes).toHaveBeenCalledTimes(2));
    expect(reorderThemes).toHaveBeenLastCalledWith("p1", ["charlie", "bravo", "alpha"]);
    expect(await screen.findByText("Ordre enregistré.")).toBeInTheDocument();
    expect(unloadPrevented()).toBe(false);
  });

  it("devrait lever la garde et signaler l'échec quand l'enregistrement échoue", async () => {
    reorderThemes.mockResolvedValueOnce({ ok: false, error: "Projet introuvable." });
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole("button", { name: "Descendre Alpha" }));
    expect(await screen.findByText(/Le nouvel ordre n'a pas été enregistré : Projet introuvable\./)).toBeInTheDocument();
    expect(screen.queryByText("Ordre enregistré.")).not.toBeInTheDocument();
    expect(unloadPrevented()).toBe(false);
  });
});
