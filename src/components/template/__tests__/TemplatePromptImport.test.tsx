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

describe("Préremplissage de la trame avec un prompt", () => {
  it("devrait analyser un texte collé et montrer la trame proposée, focus sur l'aperçu", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: {
        template: PROPOSED,
        found: ["Durée : 20 min", "3 lignes"],
        recognized: ["durationMinutes", "sections", "tone"],
        warnings: [],
      },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));

    expect(analyze).toHaveBeenCalledWith("p1", { text: PROMPT });
    const heading = await screen.findByRole("heading", { name: "Trame proposée" });
    await waitFor(() => expect(heading).toHaveFocus());
    const preview = screen.getByRole("region", { name: "Trame proposée" });
    expect(within(preview).getByText("Durée : 20 min")).toBeInTheDocument();
    expect(within(preview).getByText("3 lignes")).toBeInTheDocument();
    expect(within(preview).getByText(/Développement/)).toBeInTheDocument();
    expect(within(preview).getByText(/4 diapos/)).toBeInTheDocument();
    expect(within(preview).getByText("professionnel")).toBeInTheDocument();
  });

  it("devrait distinguer ce qui vient du texte des valeurs par défaut, et afficher les avertissements", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: {
        template: { ...PROPOSED, constraints: "Un chiffre par diapo." },
        found: ["Format : 16:9", "3 lignes", "Contraintes"],
        recognized: ["format", "sections", "constraints"],
        warnings: ["Durée non précisée dans le texte : la durée actuelle de la trame (20 min) est conservée — vérifiez-la."],
      },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    const preview = await screen.findByRole("region", { name: "Trame proposée" });

    const recognized = within(preview).getByRole("list", { name: "Trouvé dans le texte" });
    expect(within(recognized).queryByText(/Durée/)).toBeNull();
    expect(within(recognized).getByText("Format : 16:9")).toBeInTheDocument();
    // La durée et le ton sont affichés, mais comme valeurs par défaut.
    expect(within(preview).getByText("20 min").closest("dd")).toHaveTextContent("par défaut");
    expect(within(preview).getByText("professionnel").closest("dd")).toHaveTextContent("par défaut");
    expect(within(preview).getByText(/16:9 \(écran large\)/).closest("dd")).not.toHaveTextContent("par défaut");
    expect(within(preview).getByText(/Durée non précisée dans le texte/)).toBeInTheDocument();
  });

  it("devrait afficher une seule fois deux avertissements identiques, sans clé React en double", async () => {
    const twice = "Tableau : ligne 2 sans titre ignorée (« rôle »).";
    analyze.mockResolvedValue({
      ok: true,
      data: {
        template: PROPOSED,
        found: ["3 lignes"],
        recognized: ["sections"],
        warnings: [twice, twice, "Autre avertissement."],
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      renderWorkspace();
      await user.click(textarea());
      await user.paste(PROMPT);
      await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
      const preview = await screen.findByRole("region", { name: "Trame proposée" });
      expect(within(preview).getAllByText(twice)).toHaveLength(1);
      expect(within(preview).getByText("Autre avertissement.")).toBeInTheDocument();
      expect(errors.mock.calls.some((args) => String(args[0]).includes("same key"))).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });

  it("devrait appliquer la trame à l'éditeur sans enregistrer", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: {
        template: { ...PROPOSED, durationMinutes: 25 },
        found: ["Durée : 25 min"],
        recognized: ["durationMinutes"],
        warnings: [],
      },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    await user.click(await screen.findByRole("button", { name: "Appliquer à la trame" }));

    expect(screen.getByLabelText("Durée de l'oral (minutes)")).toHaveValue(25);
    expect(screen.getByLabelText("Titre de la ligne 2")).toHaveValue("Développement");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Diapos de la trame" })).toHaveFocus());
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
      data: { template: defaultTemplate(), found: [], recognized: [], warnings: [] },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste("Bonjour");
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    expect(await screen.findByText("Aucun réglage reconnu dans ce texte.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appliquer à la trame" })).not.toBeInTheDocument();
  });

  it("devrait annoncer une lecture sans IA, sans badge ni repli", async () => {
    analyze.mockResolvedValue({
      ok: true,
      data: { template: PROPOSED, found: ["Durée : 20 min"], recognized: ["durationMinutes"], warnings: [] },
    });
    const user = userEvent.setup();
    renderWorkspace();
    const region = screen.getByRole("region", { name: "Préremplir avec un prompt" });
    expect(region).toHaveTextContent("Rien n'est envoyé à une IA.");
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    const preview = await screen.findByRole("region", { name: "Trame proposée" });
    expect(preview.textContent).not.toMatch(/IA|mots-clés/);
    expect(region.textContent).not.toMatch(/Analysé par l'IA|moteur|Claude/);
  });

  it("devrait afficher la durée des lignes qui en ont une", async () => {
    const timed: PromptTemplate = {
      ...PROPOSED,
      sections: [
        { id: "c", title: "Contexte", guidance: "Enjeu", slides: 2, seconds: 180 },
        { id: "k", title: "Conclusion", guidance: "", slides: 1 },
      ],
    };
    analyze.mockResolvedValue({
      ok: true,
      data: { template: timed, found: ["2 lignes", "Durées des diapos"], recognized: ["sections"], warnings: [] },
    });
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(textarea());
    await user.paste(PROMPT);
    await user.click(screen.getByRole("button", { name: "Analyser le prompt" }));
    const preview = await screen.findByRole("region", { name: "Trame proposée" });
    const lines = within(preview).getByRole("list", { name: /Lignes/ });
    const items = within(lines).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Contexte — 2 diapos · 3:00");
    expect(items[1]).toHaveTextContent("Conclusion — 1 diapo");
    expect(items[1]).not.toHaveTextContent(":");

    await user.click(within(preview).getByRole("button", { name: "Appliquer à la trame" }));
    expect(screen.getByLabelText("Durée de la ligne 1")).toHaveValue("3:00");
    expect(screen.getByLabelText("Durée de la ligne 2")).toHaveValue("");
  });
});
