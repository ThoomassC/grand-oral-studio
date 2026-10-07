import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import type { Brand } from "@/domain/schemas";

const analyzePrompt = vi.fn();
const importList = vi.fn();
const update = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/trame/sujets", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/imports", () => ({
  analyzeBrandFile: vi.fn(),
  analyzeThemePrompt: (...args: unknown[]) => analyzePrompt(...args),
  importThemeList: (...args: unknown[]) => importList(...args),
  analyzeTemplatePrompt: vi.fn(),
}));
vi.mock("@/server/actions/programs", () => ({
  updateBrand: (...args: unknown[]) => update(...args),
}));

const { SubjectImport } = await import("@/components/themes/SubjectImport");
const { SubjectPromptImport } = await import("@/components/themes/SubjectPromptImport");
const { CurrentLogoProvider } = await import("@/components/themes/current-logo");

const IMPORTED: Brand = {
  name: "Apparence Contoso",
  colors: { primary: "#123456", secondary: "#2E7D32", accent: "#C62828", background: "#FAFAFA", text: "#212121" },
  fonts: { heading: "Georgia", body: "Verdana" },
  logoDataUrl: null,
};
const CURRENT_LOGO = "data:image/png;base64,AAAA";

/** Le texte décrit à la fois des sujets et une apparence : chaque mode ne montre que sa part. */
const PROMPT_RESULT = {
  themes: [
    { name: "Cybersécurité", description: "", keywords: [], notes: "" },
    { name: "Transformation numérique", description: "", keywords: [], notes: "" },
    { name: "Intelligence artificielle", description: "", keywords: [], notes: "" },
  ],
  brand: IMPORTED,
  brandNotes: ["Police Georgia retenue pour les titres et le texte."],
  brandFound: ["Couleur principale : #123456", "Police des titres : Georgia"],
};

function renderSubjects() {
  return render(<SubjectImport programId="p1" currentBrand={{ ...defaultBrand(), logoDataUrl: CURRENT_LOGO }} format="16:9" />);
}

function renderAppearance() {
  return render(
    <CurrentLogoProvider logo={CURRENT_LOGO}>
      <SubjectPromptImport programId="p1" format="16:9" scope="appearance" />
    </CurrentLogoProvider>,
  );
}

async function analyzeText(user: ReturnType<typeof userEvent.setup>, label: string | RegExp, text = "Sujets : 1. Cybersécurité") {
  await user.type(screen.getByLabelText(label), text);
  await user.click(screen.getByRole("button", { name: "Lire le texte" }));
}

afterEach(() => {
  cleanup();
  analyzePrompt.mockReset();
  importList.mockReset();
  update.mockReset();
});

describe("Import de sujets depuis un texte (page Sujets)", () => {
  const FIELD = "Vos sujets ou vos consignes";

  it("devrait être un bloc titré, sans fichier de présentation ni mention d'IA à l'œuvre", () => {
    renderSubjects();
    const region = screen.getByRole("region", { name: "Importer des sujets depuis un texte" });
    expect(region).toHaveAttribute("id", "importer-sujets");
    // Sous-bloc de la page Sujets (h2) : niveau 3.
    expect(within(region).getByRole("heading", { name: "Importer des sujets depuis un texte", level: 3 })).toBeInTheDocument();
    expect(within(region).queryByRole("tab")).not.toBeInTheDocument();
    expect(within(region).queryByLabelText(/Déposez votre présentation/)).not.toBeInTheDocument();
    expect(region).toHaveTextContent("Rien n'est envoyé à une IA.");
    expect(region.textContent).not.toMatch(/Claude|moteur|Analysé par l'IA/);
  });

  it("devrait exiger un texte avant d'appeler le serveur", async () => {
    const user = userEvent.setup();
    renderSubjects();
    await user.click(screen.getByRole("button", { name: "Lire le texte" }));
    expect(analyzePrompt).not.toHaveBeenCalled();
    const field = screen.getByLabelText(FIELD);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/Collez/);
  });

  it("devrait montrer les sujets cochés, sans rien de l'apparence, et déplacer le focus", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
    const user = userEvent.setup();
    renderSubjects();
    await analyzeText(user, FIELD);
    expect(analyzePrompt).toHaveBeenCalledWith("p1", { text: "Sujets : 1. Cybersécurité" });

    const heading = await screen.findByRole("heading", { name: "Sujets proposés" });
    await waitFor(() => expect(heading).toHaveFocus());
    const preview = screen.getByRole("region", { name: "Sujets proposés" });
    const boxes = within(within(preview).getByRole("group", { name: /Sujets trouvés/ })).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    boxes.forEach((b) => expect(b).toBeChecked());
    // Le texte décrivait aussi une apparence : elle n'apparaît pas ici.
    expect(within(preview).queryByText(/#123456/)).not.toBeInTheDocument();
    expect(within(preview).queryByText(/apparence/i)).not.toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "Importer 3 sujets" })).toBeInTheDocument();
  });

  it("devrait importer les seuls sujets cochés, sans toucher à l'apparence, et proposer le Jour J", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
    importList.mockResolvedValue({ ok: true, data: { created: 1, skipped: 1 } });
    const user = userEvent.setup();
    renderSubjects();
    await analyzeText(user, FIELD);
    await user.click(await screen.findByRole("checkbox", { name: /Transformation numérique/ }));
    await user.click(screen.getByRole("button", { name: "Importer 2 sujets" }));

    expect(importList).toHaveBeenCalledWith("p1", { themes: [PROMPT_RESULT.themes[0], PROMPT_RESULT.themes[2]] });
    const done = await screen.findByText("1 sujet importé, 1 déjà présent.");
    expect(done.closest("[role=status]")).not.toBeNull();
    await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
    expect(screen.getByRole("link", { name: /Passer au Jour J/ })).toHaveAttribute("href", "/projets/p1/jour-j");
    expect(update).not.toHaveBeenCalled();
  });

  it("ne devrait rien importer quand tout est décoché", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
    const user = userEvent.setup();
    renderSubjects();
    await analyzeText(user, FIELD);
    for (const box of within(await screen.findByRole("group", { name: /Sujets trouvés/ })).getAllByRole("checkbox")) {
      await user.click(box);
    }
    const submit = screen.getByRole("button", { name: /Importer/ });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAccessibleDescription("Cochez au moins un sujet pour importer.");
    await user.click(submit);
    expect(importList).not.toHaveBeenCalled();
  });

  it("devrait dire qu'aucun sujet n'est reconnu, même si une apparence l'est", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: { ...PROMPT_RESULT, themes: [] } });
    const user = userEvent.setup();
    renderSubjects();
    await analyzeText(user, FIELD, "Couleur principale : #123456");
    expect(await screen.findByText("Aucun sujet reconnu dans ce texte.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Importer/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Modifier le texte" }));
    expect(screen.getByLabelText(FIELD)).toHaveFocus();
  });

  it("devrait afficher l'erreur d'import", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
    importList.mockResolvedValue({ ok: false, error: "Un projet est limité à 60 sujets." });
    const user = userEvent.setup();
    renderSubjects();
    await analyzeText(user, FIELD);
    await user.click(await screen.findByRole("button", { name: "Importer 3 sujets" }));
    const alert = await screen.findByText(/limité à 60 sujets\./);
    expect(alert.closest("[role=alert]")).not.toBeNull();
  });

  it("devrait afficher l'erreur d'analyse renvoyée par le serveur", async () => {
    analyzePrompt.mockResolvedValue({ ok: false, error: "Trop d'imports pour le moment." });
    const user = userEvent.setup();
    renderSubjects();
    await analyzeText(user, FIELD);
    const alert = await screen.findByText(/Analyse impossible : Trop d'imports pour le moment\./);
    expect(alert.closest("[role=alert]")).not.toBeNull();
  });
});

describe("Apparence depuis un prompt (scope « appearance »)", () => {
  const FIELD = "Description de l'apparence";

  it("devrait montrer l'apparence proposée, sans aucun sujet", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
    const user = userEvent.setup();
    renderAppearance();
    expect(screen.getByText(/Rien n'est envoyé à une IA\./)).toBeInTheDocument();
    await analyzeText(user, FIELD, "Couleur principale : #123456");

    const heading = await screen.findByRole("heading", { name: "Apparence proposée" });
    await waitFor(() => expect(heading).toHaveFocus());
    const preview = screen.getByRole("region", { name: "Apparence proposée" });
    expect(within(preview).getByText("Couleur principale : #123456")).toBeInTheDocument();
    // Résumé reconnu ET aperçu des couleurs.
    expect(within(preview).getAllByText(/#123456/).length).toBeGreaterThanOrEqual(2);
    expect(within(preview).getByText("Police Georgia retenue pour les titres et le texte.")).toBeInTheDocument();
    // Le texte listait aussi des sujets : ils n'apparaissent pas ici.
    expect(within(preview).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(preview).queryByText(/Cybersécurité|sujet/i)).not.toBeInTheDocument();
  });

  it("devrait enregistrer l'apparence en gardant le logo actuel, sans importer de sujet", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
    update.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderAppearance();
    await analyzeText(user, FIELD, "Couleur principale : #123456");
    await user.click(await screen.findByRole("button", { name: "Appliquer l'apparence" }));

    expect(update).toHaveBeenCalledWith("p1", { ...IMPORTED, logoDataUrl: CURRENT_LOGO });
    expect(importList).not.toHaveBeenCalled();
    const done = await screen.findByText("Apparence appliquée et enregistrée.");
    await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
    expect(screen.queryByRole("heading", { name: "Apparence proposée" })).not.toBeInTheDocument();
  });

  it("devrait garder l'aperçu et dire pourquoi si l'enregistrement échoue", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: PROMPT_RESULT });
    update.mockResolvedValue({ ok: false, error: "Projet introuvable." });
    const user = userEvent.setup();
    renderAppearance();
    await analyzeText(user, FIELD, "Couleur principale : #123456");
    await user.click(await screen.findByRole("button", { name: "Appliquer l'apparence" }));
    const alert = await screen.findByText(/L'apparence n'a pas été appliquée : Projet introuvable\./);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Apparence proposée" })).toBeInTheDocument();
  });

  it("devrait dire qu'aucune couleur ni police n'est reconnue, même si des sujets le sont", async () => {
    analyzePrompt.mockResolvedValue({ ok: true, data: { ...PROMPT_RESULT, brand: null, brandNotes: [], brandFound: [] } });
    const user = userEvent.setup();
    renderAppearance();
    await analyzeText(user, FIELD, "Sujets : 1. Cybersécurité");
    expect(await screen.findByText("Aucune couleur ni police reconnue dans ce texte.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appliquer l'apparence" })).not.toBeInTheDocument();
  });
});
