import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1", useRouter: () => ({ push: vi.fn() }) }));
const reorderThemes = vi.fn();
const addTheme = vi.fn();
const updateTheme = vi.fn();
const importThemes = vi.fn();
vi.mock("@/server/actions/themes", () => ({
  addTheme: (...args: unknown[]) => addTheme(...args),
  deleteTheme: vi.fn(),
  reorderThemes: (...args: unknown[]) => reorderThemes(...args),
  updateTheme: (...args: unknown[]) => updateTheme(...args),
  importThemes: (...args: unknown[]) => importThemes(...args),
}));

const { ThemeManager } = await import("@/components/themes/ThemeManager");
const { UnsavedChangesBanner, UnsavedChangesProvider } = await import("@/components/layout/UnsavedChanges");

afterEach(async () => {
  cleanup();
  reorderThemes.mockReset();
  addTheme.mockReset();
  updateTheme.mockReset();
  importThemes.mockReset();
  // Laisse jsdom traiter le retrait de l'entrée sentinelle d'historique.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
});

describe("Gestionnaire de sujets (sous le bloc d'import)", () => {
  it("ne devrait plus renvoyer vers la charte ni vers le gabarit", () => {
    render(<ThemeManager programId="p1" themes={[]} />);
    expect(screen.queryByRole("link", { name: /charte d'une présentation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gabarit avec un prompt/ })).not.toBeInTheDocument();
  });

  it("devrait garder la saisie manuelle à un clic, en secondaire", async () => {
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    expect(screen.getByText("Aucun sujet")).toBeInTheDocument();
    expect(screen.getByText(/Les sujets sont facultatifs/)).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Ajouter un sujet" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    await user.click(add);
    expect(screen.getByRole("heading", { name: "Nouveau sujet" })).toBeInTheDocument();
  });

  it("devrait garder l'import de liste existant", async () => {
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    const trigger = screen.getByRole("button", { name: "Importer une liste" });
    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "Importer des sujets" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Nom | description | mot-clé 1, mot-clé 2 | notes")).toBeInTheDocument();
    expect(screen.getByLabelText("Liste des sujets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importer les sujets" })).toBeInTheDocument();
  });

  it("devrait proposer de passer au Jour J après un import réussi", async () => {
    importThemes.mockResolvedValue({ ok: true, data: { created: 2, skipped: [] } });
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    await user.click(screen.getByRole("button", { name: "Importer une liste" }));
    await user.type(screen.getByLabelText("Liste des sujets"), "Énergie | | | ADEME 2024");
    await user.click(screen.getByRole("button", { name: "Importer les sujets" }));
    expect(await screen.findByText("2 sujets créés.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Passer au Jour J/ })).toHaveAttribute("href", "/projets/p1/jour-j");
    expect(screen.queryByRole("link", { name: /squelettes/ })).not.toBeInTheDocument();
  });
});

describe("Gestionnaire de sujets — notes", () => {
  it("devrait envoyer les notes saisies (sauts de ligne compris) à l'ajout", async () => {
    addTheme.mockResolvedValue({ ok: true, data: { id: "n1" } });
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    await user.click(screen.getByRole("button", { name: "Ajouter un sujet" }));
    await user.type(screen.getByLabelText("Nom du sujet"), "Transition énergétique");
    const notes = screen.getByLabelText(/^Notes/);
    expect(notes).toHaveAttribute("maxlength", "4000");
    expect(notes).toHaveAccessibleDescription(/Chiffres, exemples, sources : le jour J, le diaporama s'appuie dessus\./);
    await user.type(notes, "42 % d'EnR en 2030{Enter}Source : ADEME");
    expect(screen.getByText("33 / 4 000 caractères")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ajouter le sujet" }));

    expect(addTheme).toHaveBeenCalledWith("p1", {
      name: "Transition énergétique",
      description: "",
      keywords: [],
      notes: "42 % d'EnR en 2030\nSource : ADEME",
    });
    expect(await screen.findByText("Sujet ajouté. Vous pouvez en saisir un autre.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Notes/)).toHaveValue("");
  });

  it("devrait montrer les notes d'un sujet et les renvoyer modifiées à l'enregistrement", async () => {
    updateTheme.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(
      <ThemeManager
        programId="p1"
        themes={[{ id: "e", name: "Énergie", description: "", keywords: ["climat"], notes: "Chiffre ADEME", finalDeckCount: 2 }]}
      />,
    );
    const item = screen.getByRole("heading", { name: /Énergie/ }).closest("li") as HTMLElement;
    expect(item).toHaveTextContent("2 diaporamas du jour J");
    expect(item).toHaveTextContent("Chiffre ADEME");
    await user.click(screen.getByRole("button", { name: "Modifier Énergie" }));
    const notes = screen.getByLabelText(/^Notes/);
    expect(notes).toHaveValue("Chiffre ADEME");
    await user.type(notes, " 2024");
    await user.click(screen.getByRole("button", { name: "Enregistrer le sujet" }));
    expect(updateTheme).toHaveBeenCalledWith("e", {
      name: "Énergie",
      description: "",
      keywords: ["climat"],
      notes: "Chiffre ADEME 2024",
    });
  });

  it("devrait refuser des notes trop longues avec l'erreur reliée au champ", async () => {
    const user = userEvent.setup();
    render(
      <ThemeManager
        programId="p1"
        themes={[{ id: "e", name: "Énergie", description: "", keywords: [], notes: "x".repeat(4001), finalDeckCount: 0 }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Modifier Énergie" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer le sujet" }));
    const notes = screen.getByLabelText(/^Notes/);
    expect(notes).toHaveAttribute("aria-invalid", "true");
    expect(notes).toHaveAccessibleDescription(/Les notes ne doivent pas dépasser 4000 caractères\./);
    expect(updateTheme).not.toHaveBeenCalled();
  });

  it("devrait annoncer la suppression des diaporamas du jour J avec le sujet", async () => {
    const user = userEvent.setup();
    render(
      <ThemeManager
        programId="p1"
        themes={[{ id: "e", name: "Énergie", description: "", keywords: [], notes: "", finalDeckCount: 2 }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Supprimer Énergie" }));
    expect(
      await screen.findByText("Supprimer le sujet « Énergie » ? Ses 2 diaporamas du jour J seront aussi supprimés."),
    ).toBeInTheDocument();
  });
});

const THEMES = ["Alpha", "Bravo", "Charlie"].map((name) => ({
  id: name.toLowerCase(),
  name,
  description: "",
  keywords: [],
  notes: "",
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

describe("Gestionnaire de sujets — enregistrement de l'ordre", () => {
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
