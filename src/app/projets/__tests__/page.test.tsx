import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgramSummary } from "@/server/queries";

const list = vi.fn<(userId: string) => Promise<ProgramSummary[]>>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/session", () => ({ requireUser: async () => ({ id: "u1", email: "a@example.test", name: "A" }) }));
vi.mock("@/server/queries", () => ({ listPrograms: (userId: string) => list(userId) }));
vi.mock("@/server/actions/programs", () => ({
  createProgram: vi.fn(),
  duplicateProgram: vi.fn(),
  deleteProgram: vi.fn(),
}));

const { default: ProgramsPage } = await import("@/app/projets/page");

afterEach(() => {
  cleanup();
  list.mockReset();
});

function program(id: string, name: string, nextStep: ProgramSummary["progress"]["nextStep"], doneCount: number): ProgramSummary {
  return {
    id,
    name,
    description: "",
    themeCount: 3,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-02"),
    progress: { doneCount, total: 3, nextStep },
  };
}

async function renderPage() {
  render(await ProgramsPage());
}

describe("Page /projets", () => {
  it("devrait placer « Nouveau projet » à côté du titre, sans formulaire latéral", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "appearance", 0)]);
    await renderPage();
    expect(list).toHaveBeenCalledWith("u1");
    expect(screen.getByRole("heading", { name: "Projets", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouveau projet" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByLabelText("Nom du projet")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Nouveau projet" })).not.toBeInTheDocument();
  });

  it("devrait ouvrir la modale de création depuis l'en-tête", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "appearance", 0)]);
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Nouveau projet" }));
    const dialog = await screen.findByRole("dialog", { name: "Nouveau projet" });
    await waitFor(() => expect(within(dialog).getByLabelText("Nom du projet")).toHaveFocus());
  });

  it("devrait garder le bouton d'avancement et ajouter le menu « ⋮ » sur chaque ligne", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "template", 1), program("p2", "Master MIAGE", "day", 2)]);
    await renderPage();
    const rows = within(screen.getByRole("region", { name: "Liste des projets" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    const [first, second] = rows as [HTMLElement, HTMLElement];
    // jsdom perd l'espace en tête du texte masqué (« — nom ») ; un navigateur le garde.
    expect(within(first).getByRole("link", { name: /^Reprendre : Trame\s*— BTS SIO$/ })).toHaveAttribute("href", "/projets/p1/trame");
    expect(within(first).getByRole("button", { name: "Actions du projet BTS SIO" })).toHaveAttribute("aria-haspopup", "menu");
    expect(within(second).getByRole("link", { name: /^Commencer le Jour J\s*— Master MIAGE$/ })).toHaveAttribute("href", "/projets/p2/jour-j");
    expect(within(second).getByRole("button", { name: "Actions du projet Master MIAGE" })).toBeInTheDocument();

    // Les actions ne sont plus des boutons visibles sur la ligne.
    expect(screen.queryByRole("button", { name: /^Dupliquer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Supprimer/ })).not.toBeInTheDocument();
    expect(screen.getByText("2 projets")).toBeInTheDocument();
  });

  it("devrait ouvrir un projet sur son apparence et compter ses sujets", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "appearance", 0)]);
    await renderPage();
    expect(screen.getByRole("link", { name: "BTS SIO" })).toHaveAttribute("href", "/projets/p1/apparence");
    expect(screen.getByRole("link", { name: /^Reprendre : Apparence/ })).toHaveAttribute("href", "/projets/p1/apparence");
    expect(screen.getByText("Sujets :").nextElementSibling).toHaveTextContent("3");
    expect(screen.queryByText(/Thèmes/)).not.toBeInTheDocument();
  });

  it("devrait proposer de créer le premier projet quand la liste est vide", async () => {
    list.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("Aucun projet pour l'instant")).toBeInTheDocument();
    expect(screen.queryByText(/avec le formulaire/)).not.toBeInTheDocument();
    const user = userEvent.setup();
    const cta = screen.getByRole("button", { name: "Créer mon premier projet" });
    await user.click(cta);
    expect(await screen.findByRole("dialog", { name: "Nouveau projet" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(cta).toHaveFocus());
  });
});
