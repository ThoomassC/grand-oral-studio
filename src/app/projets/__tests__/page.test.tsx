import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@thomascaron/opale-ui";
import type { ProgramSummary } from "@/server/queries";

const list = vi.fn<(userId: string) => Promise<ProgramSummary[]>>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/session", () => ({ requireUser: async () => ({ id: "u1", email: "a@example.test", name: "A" }) }));
const getWriter = vi.fn();
vi.mock("@/server/queries", () => ({
  listPrograms: (userId: string) => list(userId),
  getWriter: (userId: string) => getWriter(userId),
}));
vi.mock("@/server/actions/transfer", () => ({ importProject: vi.fn(), createExampleProject: vi.fn() }));
vi.mock("@/server/actions/programs", () => ({
  createProgram: vi.fn(),
  duplicateProgram: vi.fn(),
  deleteProgram: vi.fn(),
}));

const { default: ProgramsPage } = await import("@/app/projets/(liste)/page");

afterEach(() => {
  cleanup();
  list.mockReset();
  getWriter.mockReset();
});

beforeEach(() => {
  getWriter.mockResolvedValue({ engine: "mistral", keySource: "user", model: "mistral-large-latest", ready: true, problem: null, label: "Mistral (votre clé)" });
});

function program(
  id: string,
  name: string,
  nextStep: ProgramSummary["progress"]["nextStep"],
  doneCount: number,
  role: ProgramSummary["role"] = "owner",
): ProgramSummary {
  return {
    id,
    name,
    description: "",
    themeCount: 3,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-02"),
    progress: { doneCount, total: 3, nextStep, rehearsalCount: 0 },
    role,
    ownerName: role === "owner" ? null : "Alice",
  };
}

async function renderPage() {
  // ProgramActions annonce la suppression par un toast « Annuler » (useToast).
  render(<ToastProvider>{await ProgramsPage()}</ToastProvider>);
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
    expect(within(second).getByRole("link", { name: /^S'entraîner\s*— Master MIAGE$/ })).toHaveAttribute(
      "href",
      "/projets/p2/jour-j?mode=entrainement",
    );
    expect(within(second).getByRole("link", { name: /^Jour J\s*— Master MIAGE$/ })).toHaveAttribute("href", "/projets/p2/jour-j");
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

  it("devrait mentionner le rédacteur de l'utilisateur, lu une seule fois pour toute la liste", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "day", 2), program("p2", "Master MIAGE", "day", 2)]);
    await renderPage();
    expect(getWriter).toHaveBeenCalledTimes(1);
    expect(getWriter).toHaveBeenCalledWith("u1");
    expect(screen.getAllByText("Rédaction : Mistral")).toHaveLength(2);
  });

  it("ne devrait proposer à un lecteur ni l'entraînement ni le Jour J", async () => {
    list.mockResolvedValue([program("p1", "Partagé", "day", 2, "viewer")]);
    await renderPage();
    expect(screen.queryByRole("link", { name: /S'entraîner/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Ouvrir\s*— Partagé$/ })).toHaveAttribute("href", "/projets/p1/apparence");
  });

  it("devrait proposer l'import et l'exemple, discrets, à côté de « Nouveau projet »", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "day", 2)]);
    await renderPage();
    expect(screen.getByRole("button", { name: "Importer un projet (.json)" })).toHaveClass("opale-button--ghost");
    expect(screen.getByRole("button", { name: "Partir de l'exemple" })).toHaveClass("opale-button--ghost");
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
    // L'import et l'exemple, une seule fois (dans l'encart, pas en double dans l'en-tête).
    expect(screen.getAllByRole("button", { name: "Importer un projet (.json)" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Partir de l'exemple" })).toHaveLength(1);
  });
});
