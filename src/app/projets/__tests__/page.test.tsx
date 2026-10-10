import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@thomascaron/opale-ui";
import type { ProgramSummary } from "@/server/queries";
import { defaultBrand } from "@/domain/defaults";

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
    preview: { brand: defaultBrand(), format: "16:9", slide: { layout: "title", title: name, subtitle: "", bullets: [] } },
  };
}

async function renderPage() {
  // ProgramActions annonce la suppression par un toast « Annuler » (useToast).
  render(<ToastProvider>{await ProgramsPage()}</ToastProvider>);
}

describe("Page /projets", () => {
  it("devrait réunir les points de départ dans le menu de création à côté du titre", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "appearance", 0)]);
    await renderPage();
    expect(list).toHaveBeenCalledWith("u1");
    expect(screen.getByRole("heading", { name: "Projets", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer un projet" })).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByLabelText("Nom du projet")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Nouveau projet" })).not.toBeInTheDocument();
  });

  it("devrait ouvrir la modale de création depuis l'en-tête", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "appearance", 0)]);
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Créer un projet" }));
    await user.click(screen.getByRole("menuitem", { name: "Projet vierge" }));
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
    expect(screen.getAllByText("Rédaction : Mistral")).toHaveLength(1);
  });

  it("ne devrait proposer à un lecteur ni l'entraînement ni le Jour J", async () => {
    list.mockResolvedValue([program("p1", "Partagé", "day", 2, "viewer")]);
    await renderPage();
    expect(screen.queryByRole("link", { name: /S'entraîner/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Ouvrir\s*— Partagé$/ })).toHaveAttribute("href", "/projets/p1/apparence");
  });

  it("devrait proposer l'import et l'exemple dans le même menu, et rendre le focus après l'import annulé", async () => {
    list.mockResolvedValue([program("p1", "BTS SIO", "day", 2)]);
    await renderPage();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Créer un projet" });
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Partir de l'exemple" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Importer un projet (.json)" }));
    expect(await screen.findByRole("dialog", { name: "Importer un projet" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("devrait proposer de créer le premier projet quand la liste est vide", async () => {
    list.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("Aucun projet pour l'instant")).toBeInTheDocument();
    expect(screen.queryByText(/avec le formulaire/)).not.toBeInTheDocument();
    const user = userEvent.setup();
    const cta = screen.getByRole("button", { name: "Créer mon premier projet" });
    await user.click(cta);
    expect(screen.getAllByRole("menuitem", { name: "Importer un projet (.json)" })).toHaveLength(1);
    expect(screen.getAllByRole("menuitem", { name: "Partir de l'exemple" })).toHaveLength(1);
    await user.click(screen.getByRole("menuitem", { name: "Projet vierge" }));
    expect(await screen.findByRole("dialog", { name: "Nouveau projet" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(cta).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Créer un projet" })).not.toBeInTheDocument();
  });

  it("devrait montrer un aperçu fidèle et ouvrir le même projet depuis sa couverture", async () => {
    const p = program("p1", "BTS SIO", "day", 2);
    p.preview.brand.colors.primary = "#174B43";
    p.preview.format = "4:3";
    p.preview.slide.title = "Une vraie couverture";
    list.mockResolvedValue([p]);
    await renderPage();
    const cover = screen.getByRole("link", { name: "Ouvrir le projet BTS SIO" });
    expect(cover).toHaveAttribute("href", "/projets/p1/apparence");
    expect(within(cover).getByText("Une vraie couverture")).toBeInTheDocument();
    expect(cover.querySelector('[aria-hidden="true"]')).toHaveStyle({ aspectRatio: "4 / 3", backgroundColor: "#174B43" });
  });

  it("devrait combiner une recherche sans accents avec le filtre et permettre de les effacer", async () => {
    list.mockResolvedValue([
      program("p1", "Transition énergétique", "day", 2),
      program("p2", "Énergie et PME", null, 3),
      program("p3", "Cybersécurité", "day", 2, "viewer"),
    ]);
    await renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un projet" }), "ener");
    expect(screen.getByRole("status", { name: "Nombre de projets" })).toHaveTextContent("2 projets sur 3");
    await user.click(screen.getByRole("button", { name: "Prêts" }));
    expect(screen.getByRole("button", { name: "Prêts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("list", { name: "Galerie des projets" }).children).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Énergie et PME" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Partagés" }));
    expect(screen.getByText("Aucun projet trouvé")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("status", { name: "Nombre de projets" })).toHaveTextContent("3 projets");
    await user.click(screen.getByRole("button", { name: "Partagés" }));
    expect(screen.getByRole("heading", { name: "Cybersécurité" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Galerie des projets" }).children).toHaveLength(1);
  });

  it("devrait trier par nom et par modification sans changer les liens ni les droits", async () => {
    const older = program("p1", "Alpha", "day", 2);
    const newer = program("p2", "Zèbre", null, 3, "viewer");
    newer.updatedAt = new Date("2026-09-03");
    list.mockResolvedValue([older, newer]);
    await renderPage();
    const names = () => within(screen.getByRole("list", { name: "Galerie des projets" })).getAllByRole("heading").map((heading) => heading.textContent);
    expect(names()).toEqual(["Zèbre", "Alpha"]);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Trier les projets" }), "name");
    expect(names()).toEqual(["Alpha", "Zèbre"]);
    await user.click(screen.getByRole("button", { name: "En préparation" }));
    expect(names()).toEqual(["Alpha"]);
    expect(screen.getByRole("link", { name: /^S'entraîner/ })).toHaveAttribute("href", "/projets/p1/jour-j?mode=entrainement");
  });
});
