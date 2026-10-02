import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
vi.mock("@/server/actions/programs", () => ({ updateProgram: (...args: unknown[]) => update(...args) }));

const { ProjectSettingsMenu } = await import("@/components/programs/ProjectSettingsMenu");

const PROPS = { programId: "p1", name: "BTS SIO 2026", description: "Session de juin" };

afterEach(() => {
  cleanup();
  update.mockReset();
});

function gear() {
  return screen.getByRole("button", { name: "Paramètres du projet" });
}

async function openEntry(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(gear());
  await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: label }));
  return screen.findByRole("dialog");
}

describe("Menu des paramètres du projet", () => {
  it("devrait proposer Renommer et Modifier la description derrière l'engrenage", async () => {
    const user = userEvent.setup();
    render(<ProjectSettingsMenu {...PROPS} />);
    expect(gear()).toHaveAttribute("aria-haspopup", "menu");
    await user.click(gear());
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Renommer",
      "Modifier la description",
    ]);
  });

  it("devrait renommer le projet dans une modale, puis rendre le focus à l'engrenage", async () => {
    update.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<ProjectSettingsMenu {...PROPS} />);
    const dialog = await openEntry(user, "Renommer");
    expect(dialog).toHaveAccessibleName("Renommer le projet");
    const input = within(dialog).getByLabelText("Nom du projet");
    expect(input).toHaveValue("BTS SIO 2026");
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, "BTS SIO — session 2027");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));

    expect(update).toHaveBeenCalledWith("p1", { name: "BTS SIO — session 2027", description: "Session de juin" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(gear()).toHaveFocus());
    expect(screen.getByText("Projet renommé.")).toBeInTheDocument();
  });

  it("devrait signaler un nom trop court sans appeler le serveur", async () => {
    const user = userEvent.setup();
    render(<ProjectSettingsMenu {...PROPS} />);
    const dialog = await openEntry(user, "Renommer");
    const input = within(dialog).getByLabelText("Nom du projet");
    await user.clear(input);
    await user.type(input, "B");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(update).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/au moins 2 caractères/);
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("devrait afficher les erreurs de champ renvoyées par le serveur", async () => {
    update.mockResolvedValue({
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: { name: ["Le nom du projet ne doit pas dépasser 120 caractères."] },
    });
    const user = userEvent.setup();
    render(<ProjectSettingsMenu {...PROPS} />);
    const dialog = await openEntry(user, "Renommer");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    const input = within(dialog).getByLabelText("Nom du projet");
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription(/120 caractères/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("devrait tout laisser en l'état après « Annuler » et rendre le focus à l'engrenage", async () => {
    const user = userEvent.setup();
    render(<ProjectSettingsMenu {...PROPS} />);
    const dialog = await openEntry(user, "Renommer");
    await user.type(within(dialog).getByLabelText("Nom du projet"), " modifié");
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(gear()).toHaveFocus());
    expect(update).not.toHaveBeenCalled();

    const again = await openEntry(user, "Renommer");
    expect(within(again).getByLabelText("Nom du projet")).toHaveValue("BTS SIO 2026");
  });

  it("devrait fermer la modale sur Échap", async () => {
    const user = userEvent.setup();
    render(<ProjectSettingsMenu {...PROPS} />);
    await openEntry(user, "Renommer");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(gear()).toHaveFocus());
  });

  it("devrait modifier la description en gardant le nom", async () => {
    update.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<ProjectSettingsMenu {...PROPS} />);
    const dialog = await openEntry(user, "Modifier la description");
    expect(dialog).toHaveAccessibleName("Modifier la description");
    const area = within(dialog).getByLabelText(/Description/);
    await user.clear(area);
    await user.type(area, "Jury de 3 personnes");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(update).toHaveBeenCalledWith("p1", { name: "BTS SIO 2026", description: "Jury de 3 personnes" });
    expect(await screen.findByText("Description enregistrée.")).toBeInTheDocument();
  });
});
