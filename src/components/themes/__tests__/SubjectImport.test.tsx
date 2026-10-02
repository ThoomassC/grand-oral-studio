import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import type { Brand } from "@/domain/schemas";

const analyzeFile = vi.fn();
const analyzePrompt = vi.fn();
const importList = vi.fn();
const update = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/imports", () => ({
  analyzeBrandFile: (...args: unknown[]) => analyzeFile(...args),
  analyzeThemePrompt: (...args: unknown[]) => analyzePrompt(...args),
  importThemeList: (...args: unknown[]) => importList(...args),
  analyzeTemplatePrompt: vi.fn(),
}));
vi.mock("@/server/actions/programs", () => ({
  updateBrand: (...args: unknown[]) => update(...args),
}));

const { SubjectImport } = await import("@/components/themes/SubjectImport");

const IMPORTED: Brand = {
  name: "Charte Contoso",
  colors: { primary: "#123456", secondary: "#2E7D32", accent: "#C62828", background: "#FAFAFA", text: "#212121" },
  fonts: { heading: "Georgia", body: "Verdana" },
  logoDataUrl: null,
};
const CURRENT_LOGO = "data:image/png;base64,AAAA";

const PROMPT_RESULT = {
  themes: [
    { name: "Cybersécurité", description: "", keywords: [] },
    { name: "Transformation numérique", description: "", keywords: [] },
    { name: "Intelligence artificielle", description: "", keywords: [] },
  ],
  brand: IMPORTED,
  brandNotes: ["Police Georgia retenue pour les titres et le texte."],
  found: ["3 thèmes", "2 couleurs", "1 police"],
  source: "free" as const,
  fallbackReason: null,
};

function renderBlock() {
  return render(
    <SubjectImport
      programId="p1"
      currentBrand={{ ...defaultBrand(), logoDataUrl: CURRENT_LOGO }}
      format="16:9"
    />,
  );
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
  analyzeFile.mockReset();
  analyzePrompt.mockReset();
  importList.mockReset();
  update.mockReset();
});

describe("Bloc « Importer votre sujet » (onglet Thèmes)", () => {
  it("devrait être un bloc titré avec deux modes en onglets, le fichier d'abord", () => {
    renderBlock();
    const region = screen.getByRole("region", { name: "Importer votre sujet" });
    const tabs = within(region).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Depuis un fichier", "Depuis un prompt"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(region).getByText(/lecture gratuite/)).toBeInTheDocument();
    expect(within(region).getByText(/moteur Claude/)).toBeInTheDocument();
  });

  it("devrait passer au mode prompt au clavier (flèches)", async () => {
    const user = userEvent.setup();
    renderBlock();
    const [fileTab, promptTab] = screen.getAllByRole("tab");
    fileTab!.focus();
    await user.keyboard("{ArrowRight}");
    expect(promptTab).toHaveFocus();
    expect(promptTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Votre sujet ou vos consignes")).toBeVisible();
  });

  describe("depuis un fichier", () => {
    it("devrait analyser le fichier, montrer l'aperçu avec le focus, puis enregistrer la charte", async () => {
      const pending = deferred<unknown>();
      analyzeFile.mockReturnValue(pending.promise);
      update.mockResolvedValue({ ok: true, data: null });
      const user = userEvent.setup();
      renderBlock();
      const file = new File(["PK\u0003\u0004"], "charte.pptx");
      await user.upload(screen.getByLabelText(/Déposez votre présentation/), file);

      const status = await screen.findByText("Analyse de la présentation…");
      expect(status.closest("[role=status]")).not.toBeNull();
      expect(screen.getByText("charte.pptx")).toBeInTheDocument();
      const [programId, formData] = analyzeFile.mock.calls[0] as [string, FormData];
      expect(programId).toBe("p1");
      expect(formData.get("file")).toBe(file);

      pending.resolve({ ok: true, data: { brand: IMPORTED, notes: ["Police Aptos remplacée."], source: "office" } });
      const heading = await screen.findByRole("heading", { name: "Charte proposée" });
      await waitFor(() => expect(heading).toHaveFocus());
      const preview = screen.getByRole("region", { name: "Charte proposée" });
      expect(within(preview).getByText(/#123456/)).toBeInTheDocument();
      expect(within(preview).getByText("Police Aptos remplacée.")).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();

      await user.click(within(preview).getByRole("button", { name: "Appliquer la charte" }));
      // Sans logo importé, le logo actuel est gardé.
      expect(update).toHaveBeenCalledWith("p1", { ...IMPORTED, logoDataUrl: CURRENT_LOGO });
      const done = await screen.findByText(/Charte appliquée et enregistrée/);
      await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
      expect(screen.getByRole("link", { name: /onglet Charte/ })).toHaveAttribute("href", "/projets/p1/charte");
      expect(screen.queryByRole("heading", { name: "Charte proposée" })).not.toBeInTheDocument();
    });

    it("devrait garder l'aperçu et dire pourquoi si l'enregistrement échoue", async () => {
      analyzeFile.mockResolvedValue({ ok: true, data: { brand: IMPORTED, notes: [], source: "office" } });
      update.mockResolvedValue({ ok: false, error: "Projet introuvable." });
      const user = userEvent.setup();
      renderBlock();
      await user.upload(screen.getByLabelText(/Déposez votre présentation/), new File(["PK"], "a.potx"));
      await user.click(await screen.findByRole("button", { name: "Appliquer la charte" }));
      const alert = await screen.findByText(/Projet introuvable\./);
      expect(alert.closest("[role=alert]")).not.toBeNull();
      expect(screen.getByRole("heading", { name: "Charte proposée" })).toBeInTheDocument();
    });

    it("devrait afficher l'erreur d'analyse sans aperçu", async () => {
      analyzeFile.mockResolvedValue({
        ok: false,
        error: "Fichier invalide.",
        fieldErrors: { file: ["Ce fichier n'est pas une présentation PowerPoint valide."] },
      });
      const user = userEvent.setup();
      renderBlock();
      await user.upload(screen.getByLabelText(/Déposez votre présentation/), new File(["x"], "faux.pptx"));
      const alert = await screen.findByText(/n'est pas une présentation PowerPoint valide/);
      expect(alert.closest("[role=alert]")).not.toBeNull();
      expect(screen.queryByRole("heading", { name: "Charte proposée" })).not.toBeInTheDocument();
    });
    it.each(["sujet.pptm", "modele.POTM"])("devrait refuser %s (macros) avec le message dédié, sans appeler le serveur", async (name) => {
      const user = userEvent.setup();
      renderBlock();
      await user.upload(screen.getByLabelText(/Déposez votre présentation/), new File(["PK"], name));
      const alert = await screen.findByText(
        /Les fichiers avec macros \(\.pptm, \.potm\) sont refusés : enregistrez la présentation en \.pptx\./,
      );
      expect(alert.closest("[role=alert]")).not.toBeNull();
      expect(screen.queryByText(/Type de fichier non pris en charge/)).not.toBeInTheDocument();
      expect(analyzeFile).not.toHaveBeenCalled();
    });
  });

  describe("depuis un prompt", () => {
    async function analyzeText(user: ReturnType<typeof userEvent.setup>, text = "Thèmes : 1. Cybersécurité") {
      await user.click(screen.getByRole("tab", { name: "Depuis un prompt" }));
      await user.type(screen.getByLabelText("Votre sujet ou vos consignes"), text);
      await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    }

    it("devrait exiger un texte avant d'appeler le serveur", async () => {
      const user = userEvent.setup();
      renderBlock();
      await user.click(screen.getByRole("tab", { name: "Depuis un prompt" }));
      await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
      expect(analyzePrompt).not.toHaveBeenCalled();
      const field = screen.getByLabelText("Votre sujet ou vos consignes");
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(/Collez/);
    });

    it("devrait montrer les thèmes cochés, la charte, ce qui a été reconnu, et déplacer le focus", async () => {
      analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
      const user = userEvent.setup();
      renderBlock();
      await analyzeText(user);
      expect(analyzePrompt).toHaveBeenCalledWith("p1", { text: "Thèmes : 1. Cybersécurité" });

      const heading = await screen.findByRole("heading", { name: "Ce que nous avons trouvé" });
      await waitFor(() => expect(heading).toHaveFocus());
      const preview = screen.getByRole("region", { name: "Ce que nous avons trouvé" });
      const group = within(preview).getByRole("group", { name: /Thèmes trouvés/ });
      const boxes = within(group).getAllByRole("checkbox");
      expect(boxes).toHaveLength(3);
      boxes.forEach((b) => expect(b).toBeChecked());
      expect(within(preview).getByText(/sans IA/)).toBeInTheDocument();
      expect(within(preview).getByText("2 couleurs")).toBeInTheDocument();
      expect(within(preview).getByText(/#123456/)).toBeInTheDocument();
      expect(within(preview).getByText("Police Georgia retenue pour les titres et le texte.")).toBeInTheDocument();
      expect(within(preview).getByRole("checkbox", { name: "Appliquer aussi la charte" })).toBeChecked();
      expect(within(preview).getByRole("button", { name: "Importer 3 thèmes et appliquer la charte" })).toBeInTheDocument();
    });

    it("devrait importer les seuls thèmes cochés, appliquer la charte et annoncer le résultat", async () => {
      analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
      importList.mockResolvedValue({ ok: true, data: { created: 1, skipped: 1 } });
      update.mockResolvedValue({ ok: true, data: null });
      const user = userEvent.setup();
      renderBlock();
      await analyzeText(user);
      await user.click(await screen.findByRole("checkbox", { name: /Transformation numérique/ }));
      const submit = screen.getByRole("button", { name: "Importer 2 thèmes et appliquer la charte" });
      await user.click(submit);

      expect(importList).toHaveBeenCalledWith("p1", {
        themes: [PROMPT_RESULT.themes[0], PROMPT_RESULT.themes[2]],
      });
      await waitFor(() => expect(update).toHaveBeenCalledWith("p1", { ...IMPORTED, logoDataUrl: CURRENT_LOGO }));
      const done = await screen.findByText("1 thème importé, 1 déjà présent. Charte appliquée.");
      expect(done.closest("[role=status]")).not.toBeNull();
      await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
      expect(screen.getByRole("link", { name: /Passer aux squelettes/ })).toHaveAttribute("href", "/projets/p1/squelettes");
    });

    it("devrait importer les thèmes sans la charte quand la case est décochée", async () => {
      analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
      importList.mockResolvedValue({ ok: true, data: { created: 3, skipped: 0 } });
      const user = userEvent.setup();
      renderBlock();
      await analyzeText(user);
      await user.click(await screen.findByRole("checkbox", { name: "Appliquer aussi la charte" }));
      await user.click(screen.getByRole("button", { name: "Importer 3 thèmes" }));
      expect(await screen.findByText("3 thèmes importés.")).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    });

    it("ne devrait rien importer quand tout est décoché", async () => {
      analyzePrompt.mockResolvedValue({ ok: true, data: { ...PROMPT_RESULT, brand: null, brandNotes: [] } });
      const user = userEvent.setup();
      renderBlock();
      await analyzeText(user);
      for (const box of within(await screen.findByRole("group", { name: /Thèmes trouvés/ })).getAllByRole("checkbox")) {
        await user.click(box);
      }
      const submit = screen.getByRole("button", { name: /Importer/ });
      expect(submit).toHaveAttribute("aria-disabled", "true");
      expect(submit).toHaveAccessibleDescription(/Cochez au moins un thème/);
      await user.click(submit);
      expect(importList).not.toHaveBeenCalled();
    });

    it("devrait dire que rien n'a été reconnu, avec la raison du repli", async () => {
      analyzePrompt.mockResolvedValue({
        ok: true,
        data: {
          themes: [],
          brand: null,
          brandNotes: [],
          found: [],
          source: "free",
          fallbackReason: "aucune clé API n'est configurée.",
        },
      });
      const user = userEvent.setup();
      renderBlock();
      await analyzeText(user, "bonjour");
      expect(await screen.findByText("Aucun thème ni charte reconnus dans ce texte.")).toBeInTheDocument();
      expect(screen.getByText(/aucune clé API n'est configurée\./)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Importer/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Modifier le texte" }));
      expect(screen.getByLabelText("Votre sujet ou vos consignes")).toHaveFocus();
    });

    it("devrait afficher l'erreur d'import sans appliquer la charte", async () => {
      analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
      importList.mockResolvedValue({ ok: false, error: "30 thèmes au plus par projet." });
      const user = userEvent.setup();
      renderBlock();
      await analyzeText(user);
      await user.click(await screen.findByRole("button", { name: "Importer 3 thèmes et appliquer la charte" }));
      const alert = await screen.findByText(/30 thèmes au plus par projet\./);
      expect(alert.closest("[role=alert]")).not.toBeNull();
      expect(update).not.toHaveBeenCalled();
    });
  });
});
