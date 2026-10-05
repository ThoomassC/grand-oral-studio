import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import type { Brand } from "@/domain/schemas";

const analyzeFile = vi.fn();
const analyzePrompt = vi.fn();
const update = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/apparence", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/imports", () => ({
  analyzeBrandFile: (...args: unknown[]) => analyzeFile(...args),
  analyzeThemePrompt: (...args: unknown[]) => analyzePrompt(...args),
  importThemeList: vi.fn(),
  analyzeTemplatePrompt: vi.fn(),
}));
vi.mock("@/server/actions/programs", () => ({
  updateBrand: (...args: unknown[]) => update(...args),
}));

const { BrandImport } = await import("@/components/brand/BrandImport");

const IMPORTED: Brand = {
  name: "Apparence Contoso",
  colors: { primary: "#123456", secondary: "#2E7D32", accent: "#C62828", background: "#FAFAFA", text: "#212121" },
  fonts: { heading: "Georgia", body: "Verdana" },
  logoDataUrl: null,
};
const CURRENT_LOGO = "data:image/png;base64,AAAA";

function renderBlock() {
  return render(<BrandImport programId="p1" currentBrand={{ ...defaultBrand(), logoDataUrl: CURRENT_LOGO }} format="16:9" />);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const dropzone = () => screen.getByLabelText(/Déposez votre présentation/);

afterEach(() => {
  cleanup();
  analyzeFile.mockReset();
  analyzePrompt.mockReset();
  update.mockReset();
});

describe("Bloc « Partir d'un exemple » (page Apparence)", () => {
  it("devrait proposer deux modes en onglets, le fichier .pptx d'abord, sans IA", () => {
    renderBlock();
    const region = screen.getByRole("region", { name: "Partir d'un exemple" });
    expect(region).toHaveAttribute("id", "importer-apparence");
    const tabs = within(region).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Depuis un fichier .pptx", "Depuis un prompt"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(region).toHaveTextContent("Rien n'est envoyé à une IA.");
    expect(region.textContent).not.toMatch(/Claude|moteur|Configuration IA/);
  });

  it("devrait passer au mode prompt au clavier (flèches), sur l'apparence seule", async () => {
    const user = userEvent.setup();
    renderBlock();
    const [fileTab, promptTab] = screen.getAllByRole("tab");
    fileTab!.focus();
    await user.keyboard("{ArrowRight}");
    expect(promptTab).toHaveFocus();
    expect(promptTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Description de l'apparence")).toBeVisible();
  });

  it("devrait analyser le fichier, montrer l'aperçu avec le focus, puis enregistrer l'apparence", async () => {
    const pending = deferred<unknown>();
    analyzeFile.mockReturnValue(pending.promise);
    update.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderBlock();
    const file = new File(["PK\u0003\u0004"], "apparence.pptx");
    await user.upload(dropzone(), file);

    const status = await screen.findByText("Analyse de la présentation…");
    expect(status.closest("[role=status]")).not.toBeNull();
    expect(screen.getByText("apparence.pptx")).toBeInTheDocument();
    const [programId, formData] = analyzeFile.mock.calls[0] as [string, FormData];
    expect(programId).toBe("p1");
    expect(formData.get("file")).toBe(file);

    pending.resolve({ ok: true, data: { brand: IMPORTED, notes: ["Police Aptos remplacée."] } });
    const heading = await screen.findByRole("heading", { name: "Apparence proposée" });
    await waitFor(() => expect(heading).toHaveFocus());
    const preview = screen.getByRole("region", { name: "Apparence proposée" });
    expect(within(preview).getByText(/#123456/)).toBeInTheDocument();
    expect(within(preview).getByText("Police Aptos remplacée.")).toBeInTheDocument();
    expect(within(preview).getByText(/Lue dans le fichier, sans IA\./)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    await user.click(within(preview).getByRole("button", { name: "Appliquer l'apparence" }));
    // Sans logo importé, le logo actuel est gardé.
    expect(update).toHaveBeenCalledWith("p1", { ...IMPORTED, logoDataUrl: CURRENT_LOGO });
    const done = await screen.findByText("Apparence appliquée et enregistrée.");
    await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
    // L'éditeur est sur la même page : plus de lien vers une autre page.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Apparence proposée" })).not.toBeInTheDocument();
  });

  it("devrait garder l'aperçu et dire pourquoi si l'enregistrement échoue", async () => {
    analyzeFile.mockResolvedValue({ ok: true, data: { brand: IMPORTED, notes: [] } });
    update.mockResolvedValue({ ok: false, error: "Projet introuvable." });
    const user = userEvent.setup();
    renderBlock();
    await user.upload(dropzone(), new File(["PK"], "a.potx"));
    await user.click(await screen.findByRole("button", { name: "Appliquer l'apparence" }));
    const alert = await screen.findByText(/L'apparence n'a pas été appliquée : Projet introuvable\./);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Apparence proposée" })).toBeInTheDocument();
  });

  it("devrait afficher l'erreur d'analyse sans aperçu", async () => {
    analyzeFile.mockResolvedValue({
      ok: false,
      error: "Fichier invalide.",
      fieldErrors: { file: ["Ce fichier n'est pas une présentation PowerPoint valide."] },
    });
    const user = userEvent.setup();
    renderBlock();
    await user.upload(dropzone(), new File(["x"], "faux.pptx"));
    const alert = await screen.findByText(/n'est pas une présentation PowerPoint valide/);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Apparence proposée" })).not.toBeInTheDocument();
  });

  it.each(["sujet.pptm", "modele.POTM"])("devrait refuser %s (macros) avec le message dédié, sans appeler le serveur", async (name) => {
    const user = userEvent.setup();
    renderBlock();
    await user.upload(dropzone(), new File(["PK"], name));
    const alert = await screen.findByText(
      /Les fichiers avec macros \(\.pptm, \.potm\) sont refusés : enregistrez la présentation en \.pptx\./,
    );
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(analyzeFile).not.toHaveBeenCalled();
  });

  it.each(["guide.pdf", "logo.png", "photo.JPG", "photo.jpeg"])(
    "devrait refuser %s : l'import depuis un PDF ou une image n'est plus proposé",
    async (name) => {
      const user = userEvent.setup();
      renderBlock();
      await user.upload(dropzone(), new File(["x"], name));
      const alert = await screen.findByText(
        /L'import depuis un PDF ou une image n'est plus proposé : utilisez un \.pptx, \.potx ou \.thmx d'exemple\./,
      );
      expect(alert.closest("[role=alert]")).not.toBeNull();
      expect(screen.queryByText(/Type de fichier non pris en charge/)).not.toBeInTheDocument();
      expect(analyzeFile).not.toHaveBeenCalled();
    },
  );
});
