import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const importProject = vi.fn();
const createExampleProject = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/actions/transfer", () => ({
  importProject: (...args: unknown[]) => importProject(...args),
  createExampleProject: (...args: unknown[]) => createExampleProject(...args),
}));

const { ProjectListActions } = await import("@/components/programs/ProjectListActions");

afterEach(() => {
  cleanup();
  push.mockReset();
  importProject.mockReset();
  createExampleProject.mockReset();
});

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Importer un projet (.json)" }));
  return screen.findByRole("dialog", { name: "Importer un projet" });
}

describe("ProjectListActions — import et exemple", () => {
  it("devrait proposer l'import (.json) dans une modale et « Partir de l'exemple »", () => {
    render(<ProjectListActions />);
    expect(screen.getByRole("button", { name: "Importer un projet (.json)" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("button", { name: "Partir de l'exemple" })).toBeInTheDocument();
  });

  it("devrait envoyer le fichier sous `file` puis ouvrir le projet importé", async () => {
    importProject.mockResolvedValue({ ok: true, data: { id: "np1", reused: false } });
    const user = userEvent.setup();
    render(<ProjectListActions />);
    const dialog = await openImport(user);
    const file = new File(['{"format":"grand-oral-studio/projet"}'], "projet.json", { type: "application/json" });
    await user.upload(within(dialog).getByLabelText(/Déposez le fichier d'export/), file);
    await waitFor(() => expect(importProject).toHaveBeenCalledTimes(1));
    const sent = importProject.mock.calls[0]![0] as FormData;
    expect(sent).toBeInstanceOf(FormData);
    expect((sent.get("file") as File).name).toBe("projet.json");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projets/np1/apparence"));
  });

  it("devrait afficher le refus du serveur dans la modale, sans naviguer", async () => {
    importProject.mockResolvedValue({ ok: false, error: "Ce fichier n'est pas un export de projet." });
    const user = userEvent.setup();
    render(<ProjectListActions />);
    const dialog = await openImport(user);
    await user.upload(within(dialog).getByLabelText(/Déposez le fichier d'export/), new File(["{}"], "autre.json"));
    expect(await within(dialog).findByText(/Ce fichier n'est pas un export de projet\./)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("devrait refuser un fichier qui n'est pas un .json avant tout envoi", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProjectListActions />);
    const dialog = await openImport(user);
    await user.upload(within(dialog).getByLabelText(/Déposez le fichier d'export/), new File(["x"], "deck.pptx"));
    expect(await within(dialog).findByText(/fichier d'export de projet \(\.json\)/)).toBeInTheDocument();
    expect(importProject).not.toHaveBeenCalled();
  });

  it("devrait créer le projet d'exemple et l'ouvrir", async () => {
    createExampleProject.mockResolvedValue({ ok: true, data: { id: "ex1", reused: false } });
    const user = userEvent.setup();
    render(<ProjectListActions />);
    await user.click(screen.getByRole("button", { name: "Partir de l'exemple" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projets/ex1/apparence"));
    expect(createExampleProject).toHaveBeenCalledTimes(1);
  });

  it("devrait annoncer l'échec de la création de l'exemple", async () => {
    createExampleProject.mockResolvedValue({ ok: false, error: "Trop d'imports en peu de temps." });
    const user = userEvent.setup();
    render(<ProjectListActions />);
    await user.click(screen.getByRole("button", { name: "Partir de l'exemple" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trop d'imports en peu de temps.");
    expect(push).not.toHaveBeenCalled();
  });
});
