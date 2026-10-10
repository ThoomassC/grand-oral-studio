import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/trame", useRouter: () => ({ push: vi.fn(), refresh }) }));
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

const { ModelLibrary } = await import("@/components/projects/ModelLibrary");

afterEach(() => {
  cleanup();
  refresh.mockReset();
  for (const mock of [publishModel, listSharedModels, applyModel, deleteModel]) mock.mockReset();
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

describe("Bibliothèque de modèles — apparences", () => {
  it("devrait publier l'apparence enregistrée sous le nom demandé", async () => {
    publishModel.mockResolvedValue({ ok: true, data: { id: "m9", reused: false } });
    const user = userEvent.setup();
    render(<ModelLibrary programId="p1" kind="brand" defaultName="Ma charte" canPublish />);
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
    render(<ModelLibrary programId="p1" kind="brand" canPublish={false} />);
    expect(screen.queryByRole("button", { name: "Publier dans la bibliothèque" })).not.toBeInTheDocument();
    // L'éditeur garde la bibliothèque (appliquer un modèle) ; l'état vide ne l'invite pas à publier.
    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    expect(await screen.findByText("Aucun modèle publié")).toBeInTheDocument();
    expect(screen.queryByText(/Publier dans la bibliothèque/)).not.toBeInTheDocument();
    cleanup();

    render(<ModelLibrary programId="p1" kind="brand" canPublish />);
    expect(screen.getByRole("button", { name: "Publier dans la bibliothèque" })).toBeInTheDocument();
  });

  it("devrait charger la bibliothèque à l'ouverture et dire quand elle est vide", async () => {
    listSharedModels.mockResolvedValue({ ok: true, data: [] });
    const user = userEvent.setup();
    render(<ModelLibrary programId="p1" kind="brand" canPublish={false} />);
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
    render(<ModelLibrary programId="p1" kind="brand" canPublish={false} />);
    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    expect(await screen.findByText(/n'a pas pu être chargée : Service indisponible\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("heading", { name: "Charte de l'école", level: 4 })).toBeInTheDocument();
  });

  it("devrait appliquer un modèle après confirmation, puis recharger la page", async () => {
    listSharedModels.mockResolvedValue({ ok: true, data: [MODEL] });
    applyModel.mockResolvedValue({ ok: true, data: { kind: "brand" } });
    const user = userEvent.setup();
    render(<ModelLibrary programId="p1" kind="brand" canPublish={false} />);
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
    render(<ModelLibrary programId="p1" kind="brand" canPublish={false} />);
    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    await user.click(await screen.findByRole("button", { name: "Retirer « Charte de l'école » de la bibliothèque" }));
    const confirm = await screen.findByRole("dialog", { name: "Retirer de la bibliothèque ?" });
    await user.click(within(confirm).getByRole("button", { name: "Retirer le modèle" }));
    await waitFor(() => expect(deleteModel).toHaveBeenCalledWith("m1"));
    expect(await screen.findByText("Aucun modèle publié")).toBeInTheDocument();
  });
});

