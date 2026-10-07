import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import type { Brand } from "@/domain/schemas";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/apparence", useRouter: () => ({ push: vi.fn(), refresh }) }));
const updateBrand = vi.fn();
vi.mock("@/server/actions/programs", () => ({ updateBrand: (...args: unknown[]) => updateBrand(...args) }));
const publishModel = vi.fn();
const listSharedModels = vi.fn();
const applyModel = vi.fn();
const deleteModel = vi.fn();
vi.mock("@/server/actions/shared-models", () => ({
  publishModel: (...args: unknown[]) => publishModel(...args),
  listSharedModels: (...args: unknown[]) => listSharedModels(...args),
  applyModel: (...args: unknown[]) => applyModel(...args),
  deleteModel: (...args: unknown[]) => deleteModel(...args),
}));

const { BrandWorkspace } = await import("@/components/brand/BrandWorkspace");

/** Versions (brandSavedAt) de l'apparence : chargée avec la page, puis renvoyées par les enregistrements. */
const V0 = "2026-10-01T08:00:00.000Z";
const V1 = "2026-10-01T08:05:00.000Z";
const V2 = "2026-10-01T08:06:00.000Z";

afterEach(() => {
  cleanup();
  updateBrand.mockReset();
  refresh.mockReset();
  for (const mock of [publishModel, listSharedModels, applyModel, deleteModel]) mock.mockReset();
});

describe("Éditeur de la page Apparence", () => {
  it("ne devrait plus renvoyer vers une autre page pour importer (thèmes, sujets)", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Thèmes/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Déposez votre présentation/)).not.toBeInTheDocument();
  });

  it("devrait garder l'apparence entièrement modifiable", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#1E3A5F");
    expect(screen.getByLabelText("Titres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeInTheDocument();
  });

  it("devrait garder « Apparence enregistrée. » quand la page se rafraîchit avec l'apparence enregistrée", async () => {
    updateBrand.mockResolvedValue({ ok: true, data: { brandSavedAt: V1 } });
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const name = screen.getByRole("textbox", { name: "Nom de l'apparence" });
    fireEvent.change(name, { target: { value: "Couleurs du master" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'apparence" }));
    await screen.findByText("Apparence enregistrée.");
    // Rafraîchissement serveur après l'enregistrement : même apparence, nouvelle date d'enregistrement.
    rerender(<BrandWorkspace programId="p1" initialBrand={{ ...initial, name: "Couleurs du master" }} format="16:9" />);
    expect(screen.getByText("Apparence enregistrée.")).toBeInTheDocument();
  });

  it("devrait reprendre l'apparence importée quand elle change côté serveur", async () => {
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const imported = { ...initial, name: "Apparence importée", colors: { ...initial.colors, primary: "#AA3300" } };
    rerender(<BrandWorkspace programId="p1" initialBrand={imported} format="16:9" />);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#AA3300"),
    );
    expect(screen.getByRole("textbox", { name: "Nom de l'apparence" })).toHaveValue("Apparence importée");
  });

  it("devrait prévenir, sous le choix de police, qu'une police non système n'est pas incluse dans le .pptx", async () => {
    const initial: Brand = { ...defaultBrand(), fonts: { heading: "Arial", body: "Arial" } };
    render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const warning = /Cette police n'est pas incluse dans le fichier PowerPoint/;
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Titres"), { target: { value: "Montserrat" } });
    const shown = await screen.findAllByText(warning);
    expect(shown).toHaveLength(1);
    // Sous le champ « Titres », pas sous « Texte ».
    const field = (label: string) =>
      document.querySelector(`label[for="${screen.getByLabelText(label).id}"]`)!.parentElement!;
    expect(field("Titres")).toContainElement(shown[0]!);
    expect(field("Texte")).not.toContainElement(shown[0]!);

    fireEvent.change(screen.getByLabelText("Titres"), { target: { value: "Georgia" } });
    await waitFor(() => expect(screen.queryByText(warning)).not.toBeInTheDocument());
  });
});

describe("Éditeur de la page Apparence — concurrence optimiste", () => {
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'apparence" }));

  it("devrait renvoyer la version reçue au chargement, puis celle du dernier enregistrement", async () => {
    updateBrand
      .mockResolvedValueOnce({ ok: true, data: { brandSavedAt: V1 } })
      .mockResolvedValueOnce({ ok: true, data: { brandSavedAt: V2 } });
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} savedAt={V0} format="16:9" />);
    save();
    await screen.findByText("Apparence enregistrée.");
    save();
    await waitFor(() => expect(updateBrand).toHaveBeenCalledTimes(2));
    expect(updateBrand.mock.calls.map((call) => call[2])).toEqual([V0, V1]);
  });

  it("devrait reprendre la version du serveur avec l'apparence importée", async () => {
    updateBrand.mockResolvedValue({ ok: true, data: { brandSavedAt: V2 } });
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} savedAt={V0} format="16:9" />);
    rerender(<BrandWorkspace programId="p1" initialBrand={{ ...initial, name: "Importée" }} savedAt={V1} format="16:9" />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Nom de l'apparence" })).toHaveValue("Importée"));
    save();
    await waitFor(() => expect(updateBrand).toHaveBeenCalledTimes(1));
    expect(updateBrand.mock.calls[0]?.[2]).toBe(V1);
  });

  it("devrait afficher le conflit et garder la saisie quand l'apparence a changé entre-temps", async () => {
    const conflict = "L'apparence a été modifiée entre-temps (autre onglet ou autre membre du projet). Rechargez la page.";
    updateBrand.mockResolvedValue({ ok: false, error: conflict, code: "CONFLICT" });
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} savedAt={null} format="16:9" />);
    const name = screen.getByRole("textbox", { name: "Nom de l'apparence" });
    fireEvent.change(name, { target: { value: "Ma charte" } });
    save();
    expect(await screen.findByText(conflict)).toBeInTheDocument();
    expect(updateBrand.mock.calls[0]?.[2]).toBeNull();
    expect(name).toHaveValue("Ma charte");
  });
});

const MODEL = {
  id: "m1",
  kind: "brand" as const,
  name: "Charte de l'école",
  authorName: "Alice",
  isMine: false,
  createdAt: "2026-10-01T08:00:00.000Z",
  preview: {
    kind: "brand" as const,
    colors: { primary: "#112233", secondary: "#445566", accent: "#778899", background: "#FFFFFF", text: "#000000" },
    fonts: { heading: "Georgia", body: "Arial" },
    hasLogo: true,
  },
};

describe("Page Apparence — bibliothèque de l'équipe", () => {
  it("devrait publier l'apparence enregistrée sous le nom demandé", async () => {
    publishModel.mockResolvedValue({ ok: true, data: { id: "m9", reused: false } });
    const user = userEvent.setup();
    render(<BrandWorkspace programId="p1" initialBrand={{ ...defaultBrand(), name: "Ma charte" }} format="16:9" canPublish />);
    await user.click(screen.getByRole("button", { name: "Publier dans la bibliothèque" }));
    const dialog = await screen.findByRole("dialog", { name: "Publier dans la bibliothèque" });
    expect(dialog).toHaveAccessibleDescription(/apparence enregistrée/);
    const name = within(dialog).getByLabelText("Nom du modèle");
    expect(name).toHaveValue("Ma charte");
    await user.clear(name);
    await user.click(within(dialog).getByRole("button", { name: "Publier" }));
    expect(publishModel).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Donnez un nom au modèle.")).toBeInTheDocument();
    await user.type(name, "Charte BTS");
    await user.click(within(dialog).getByRole("button", { name: "Publier" }));
    expect(publishModel).toHaveBeenCalledWith("p1", { kind: "brand", name: "Charte BTS" });
    expect(await screen.findByText("« Charte BTS » publié dans la bibliothèque de l'équipe.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ne devrait proposer la publication qu'au propriétaire du projet (un éditeur reçoit 403)", async () => {
    listSharedModels.mockResolvedValue({ ok: true, data: [] });
    const user = userEvent.setup();
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.queryByRole("button", { name: "Publier dans la bibliothèque" })).not.toBeInTheDocument();
    // L'éditeur garde la bibliothèque (appliquer un modèle) ; l'état vide ne l'invite pas à publier.
    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    expect(await screen.findByText("Aucun modèle publié")).toBeInTheDocument();
    expect(screen.queryByText(/Publier dans la bibliothèque/)).not.toBeInTheDocument();
    cleanup();

    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" canPublish />);
    expect(screen.getByRole("button", { name: "Publier dans la bibliothèque" })).toBeInTheDocument();
  });

  it("devrait charger la bibliothèque à l'ouverture et dire quand elle est vide", async () => {
    listSharedModels.mockResolvedValue({ ok: true, data: [] });
    const user = userEvent.setup();
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    const toggle = screen.getByRole("button", { name: "Voir la bibliothèque" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(listSharedModels).toHaveBeenCalledWith("brand");
    expect(await screen.findByText("Aucun modèle publié")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Masquer la bibliothèque" })).toHaveAttribute("aria-expanded", "true");
  });

  it("devrait proposer de réessayer quand la bibliothèque ne se charge pas", async () => {
    listSharedModels.mockResolvedValueOnce({ ok: false, error: "Service indisponible." }).mockResolvedValueOnce({ ok: true, data: [MODEL] });
    const user = userEvent.setup();
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    expect(await screen.findByText(/n'a pas pu être chargée : Service indisponible\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("heading", { name: "Charte de l'école", level: 4 })).toBeInTheDocument();
  });

  it("devrait appliquer un modèle après confirmation, puis recharger la page", async () => {
    listSharedModels.mockResolvedValue({ ok: true, data: [MODEL] });
    applyModel.mockResolvedValue({ ok: true, data: { kind: "brand" } });
    const user = userEvent.setup();
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    const item = (await screen.findByRole("heading", { name: "Charte de l'école", level: 4 })).closest("li") as HTMLElement;
    expect(item).toHaveTextContent("Publié par Alice");
    expect(item).toHaveTextContent("#112233");
    expect(within(item).queryByRole("button", { name: /Retirer/ })).not.toBeInTheDocument();
    await user.click(within(item).getByRole("button", { name: "Appliquer « Charte de l'école » à ce projet" }));
    const confirm = await screen.findByRole("dialog", { name: "Remplacer l'apparence ?" });
    expect(applyModel).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Remplacer l'apparence" }));
    await waitFor(() => expect(applyModel).toHaveBeenCalledWith("p1", "m1"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/« Charte de l'école » appliqué/)).toBeInTheDocument();
  });

  it("devrait laisser l'auteur retirer son modèle", async () => {
    listSharedModels.mockResolvedValue({ ok: true, data: [{ ...MODEL, isMine: true }] });
    deleteModel.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    await user.click(await screen.findByRole("button", { name: "Retirer « Charte de l'école » de la bibliothèque" }));
    const confirm = await screen.findByRole("dialog", { name: "Retirer de la bibliothèque ?" });
    await user.click(within(confirm).getByRole("button", { name: "Retirer le modèle" }));
    await waitFor(() => expect(deleteModel).toHaveBeenCalledWith("m1"));
    expect(await screen.findByText("Aucun modèle publié")).toBeInTheDocument();
  });
});

describe("Page Apparence — lecteur", () => {
  it("devrait montrer l'apparence sans éditeur, sans enregistrement ni bibliothèque", () => {
    render(<BrandWorkspace programId="p1" initialBrand={{ ...defaultBrand(), name: "Charte du master" }} format="16:9" readOnly />);
    expect(screen.getByRole("heading", { name: "Charte du master", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("#1E3A5F")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publier dans la bibliothèque" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voir la bibliothèque" })).not.toBeInTheDocument();
  });
});
