import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import type { PromptTemplate } from "@/domain/schemas";

const analyze = vi.fn();
const update = vi.fn();
vi.mock("@/server/actions/imports", () => ({
  analyzeBrandFile: vi.fn(),
  analyzeTemplatePrompt: (...args: unknown[]) => analyze(...args),
}));
vi.mock("@/server/actions/programs", () => ({
  updateBrand: vi.fn(),
  updateTemplate: (...args: unknown[]) => update(...args),
}));

const { TemplateWorkspace } = await import("@/components/template/TemplateWorkspace");

const PROMPT = "Oral de 20 minutes en 16:9. Sections : 1. Introduction (1 diapo) 2. Conclusion (1 diapo). Ton : professionnel.";

const PROPOSED: PromptTemplate = {
  format: "16:9",
  language: "fr",
  durationMinutes: 20,
  sections: [
    { id: "i1", title: "Introduction", guidance: "", slides: 1 },
    { id: "i2", title: "Développement", guidance: "", slides: 4 },
    { id: "i3", title: "Conclusion", guidance: "", slides: 1 },
  ],
  tone: "professionnel",
  constraints: "",
};

function renderWorkspace() {
  return render(<TemplateWorkspace programId="p1" initialTemplate={defaultTemplate()} />);
}

const textarea = () => screen.getByLabelText("Consignes ou prompt");

afterEach(() => {
  cleanup();
  analyze.mockReset();
  update.mockReset();
});

describe("Préremplissage du gabarit avec un prompt", () => {
  it("devrait analyser un texte collé et montrer le gabarit proposé, focus sur l'aperçu", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: { template: PROPOSED, found: ["Durée : 20 min", "3 sections"], source: "ai", fallbackReason: null },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));

    expect(analyze).toHaveBeenCalledWith("p1", { text: PROMPT });
    const heading = await screen.findByRole("heading", { name: "Gabarit proposé" });
    await waitFor(() => expect(heading).toHaveFocus());
    const preview = screen.getByRole("region", { name: "Gabarit proposé" });
    expect(within(preview).getByText("Analysé par l'IA")).toBeInTheDocument();
    expect(within(preview).getByText("Durée : 20 min")).toBeInTheDocument();
    expect(within(preview).getByText("3 sections")).toBeInTheDocument();
    expect(within(preview).getByText(/Développement/)).toBeInTheDocument();
    expect(within(preview).getByText(/4 diapos/)).toBeInTheDocument();
    expect(within(preview).getByText("professionnel")).toBeInTheDocument();
  });

  it("devrait appliquer le gabarit à l'éditeur sans enregistrer", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: { template: { ...PROPOSED, durationMinutes: 25 }, found: ["Durée : 25 min"], source: "ai", fallbackReason: null },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    await user.click(await screen.findByRole("button", { name: "Appliquer au gabarit" }));

    expect(screen.getByLabelText("Durée de l'oral (minutes)")).toHaveValue(25);
    expect(screen.getByLabelText("Titre de la section 2")).toHaveValue("Développement");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Gabarit de présentation" })).toHaveFocus());
    expect(update).not.toHaveBeenCalled();
  });

  it("devrait charger un fichier .txt dans le champ", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(
      screen.getByLabelText(/Ou déposez un fichier/),
      new File(["Oral de 15 minutes."], "consignes.txt", { type: "text/plain" }),
    );
    await waitFor(() => expect(textarea()).toHaveValue("Oral de 15 minutes."));
    expect(screen.getByText("consignes.txt")).toBeInTheDocument();
  });

  it("devrait refuser clairement un fichier de plus de 20 000 caractères", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.upload(
      screen.getByLabelText(/Ou déposez un fichier/),
      new File(["a".repeat(20_001)], "long.md", { type: "text/markdown" }),
    );
    const error = await screen.findByText(/la limite est de 20 000/);
    expect(error.closest("[role=alert]")).not.toBeNull();
    expect(textarea()).toHaveValue("");
  });

  it("devrait refuser un champ vide sans appeler le serveur", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    expect(await screen.findByText("Collez les consignes à analyser.")).toBeInTheDocument();
    expect(textarea()).toHaveAttribute("aria-invalid", "true");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("devrait dire qu'aucun réglage n'est reconnu, sans proposer d'appliquer", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: { template: defaultTemplate(), found: [], source: "free", fallbackReason: null },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste("Bonjour");
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    expect(await screen.findByText("Aucun réglage reconnu dans ce texte.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appliquer au gabarit" })).not.toBeInTheDocument();
  });

  it("devrait signaler le repli sans IA et sa raison", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: { template: PROPOSED, found: ["Durée : 20 min"], source: "free", fallbackReason: "Le service IA n'a pas répondu." },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    const preview = await screen.findByRole("region", { name: "Gabarit proposé" });
    expect(within(preview).getByText("Analyse sans IA (mots-clés)")).toBeInTheDocument();
    expect(within(preview).getByText(/Le service IA n'a pas répondu\./)).toBeInTheDocument();
  });
});
