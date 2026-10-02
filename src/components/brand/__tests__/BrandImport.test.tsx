import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import type { Brand } from "@/domain/schemas";

const analyze = vi.fn();
const update = vi.fn();
vi.mock("@/server/actions/imports", () => ({
  analyzeBrandFile: (...args: unknown[]) => analyze(...args),
  analyzeTemplatePrompt: vi.fn(),
}));
vi.mock("@/server/actions/programs", () => ({
  updateBrand: (...args: unknown[]) => update(...args),
  updateTemplate: vi.fn(),
}));

const { BrandWorkspace } = await import("@/components/brand/BrandWorkspace");

const IMPORTED: Brand = {
  name: "Charte Contoso",
  colors: { primary: "#123456", secondary: "#2E7D32", accent: "#C62828", background: "#FAFAFA", text: "#212121" },
  fonts: { heading: "Georgia", body: "Verdana" },
  logoDataUrl: null,
};

function renderWorkspace() {
  return render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
}

function dropzoneInput(): HTMLInputElement {
  return screen.getByLabelText(/Déposez votre présentation/) as HTMLInputElement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  analyze.mockReset();
  update.mockReset();
});

describe("Import de la charte depuis une présentation", () => {
  it("devrait dire ce qui est gratuit et ce qui demande Claude", () => {
    renderWorkspace();
    const region = screen.getByRole("region", { name: "Importer depuis une présentation" });
    expect(within(region).getByText(/gratuit/)).toBeInTheDocument();
    expect(within(region).getByText(/moteur Claude/)).toBeInTheDocument();
  });

  it("devrait analyser un .pptx, annoncer l'analyse puis montrer l'aperçu avec le focus", async () => {
    const pending = deferred<unknown>();
    analyze.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderWorkspace();
    const file = new File(["PK\u0003\u0004"], "charte.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    await user.upload(dropzoneInput(), file);

    const status = await screen.findByText("Analyse de la présentation…");
    expect(status.closest("[role=status]")).not.toBeNull();
    expect(screen.getByText("charte.pptx")).toBeInTheDocument();
    expect(analyze).toHaveBeenCalledTimes(1);
    const [programId, formData] = analyze.mock.calls[0] as [string, FormData];
    expect(programId).toBe("p1");
    expect(formData.get("file")).toBe(file);

    pending.resolve({
      ok: true,
      data: { brand: IMPORTED, notes: ["Police Aptos remplacée par Calibri."], source: "office" },
    });

    const heading = await screen.findByRole("heading", { name: "Charte proposée" });
    await waitFor(() => expect(heading).toHaveFocus());
    const preview = screen.getByRole("region", { name: "Charte proposée" });
    expect(within(preview).getByText(/#123456/)).toBeInTheDocument();
    expect(within(preview).getByText(/Principale/)).toBeInTheDocument();
    expect(within(preview).getByText("Georgia")).toBeInTheDocument();
    expect(within(preview).getByText("Verdana")).toBeInTheDocument();
    expect(within(preview).getByText("Police Aptos remplacée par Calibri.")).toBeInTheDocument();
    expect(within(preview).getByText(/sans IA/)).toBeInTheDocument();
  });

  it("devrait appliquer la charte à l'éditeur sans enregistrer, et marquer le formulaire modifié", async () => {
    analyze.mockResolvedValue({ ok: true, data: { brand: IMPORTED, notes: [], source: "office" } });
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(dropzoneInput(), new File(["PK"], "charte.potx"));
    await user.click(await screen.findByRole("button", { name: "Appliquer à la charte" }));

    expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#123456");
    expect(screen.getByLabelText("Titres")).toHaveValue("Georgia");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Charte proposée" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Charte graphique" })).toHaveFocus());
    expect(screen.getByText(/vérifiez puis enregistrez/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("devrait refuser un fichier à macros sans appeler le serveur", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWorkspace();
    await user.upload(dropzoneInput(), new File(["PK"], "macro.pptm"));
    expect(await screen.findByText(/Type de fichier non pris en charge/)).toBeInTheDocument();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("devrait afficher l'erreur du serveur près de la zone, sans aperçu", async () => {
    analyze.mockResolvedValue({
      ok: false,
      error: "Ce fichier n'est pas une présentation PowerPoint valide.",
      fieldErrors: { file: ["Ce fichier n'est pas une présentation PowerPoint valide."] },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(dropzoneInput(), new File(["nope"], "faux.pptx"));
    const alert = await screen.findByText(/Ce fichier n'est pas une présentation PowerPoint valide\./);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Charte proposée" })).not.toBeInTheDocument();
  });

  it("devrait tout laisser en l'état après « Annuler »", async () => {
    analyze.mockResolvedValue({ ok: true, data: { brand: IMPORTED, notes: [], source: "office" } });
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(dropzoneInput(), new File(["PK"], "charte.thmx"));
    await user.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("heading", { name: "Charte proposée" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#1E3A5F");
    expect(screen.queryByText("Modifications non enregistrées")).not.toBeInTheDocument();
    await waitFor(() => expect(dropzoneInput()).toHaveFocus());
  });
});
