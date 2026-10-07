import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSetupStatus, ConnectionStatus } from "@/components/settings/ai-status";

const selectWriter = vi.fn();
const connectProvider = vi.fn();
const testConnection = vi.fn();
const deleteConnection = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/settings", () => ({
  selectWriter: (...args: unknown[]) => selectWriter(...args),
  connectProvider: (...args: unknown[]) => connectProvider(...args),
  testConnection: (...args: unknown[]) => testConnection(...args),
  deleteConnection: (...args: unknown[]) => deleteConnection(...args),
  setConnectionModel: vi.fn(),
}));

const { AiSetup } = await import("@/components/settings/AiSetup");

function status(overrides: Partial<AiSetupStatus> = {}): AiSetupStatus {
  return { saved: "free", team: [], connections: [], ollama: null, ...overrides };
}

const CLAUDE: ConnectionStatus = {
  provider: "claude",
  last4: "4f2a",
  model: "claude-opus-5-5",
  modelLabel: "Claude Opus 5.5",
  verifiedAtLabel: "6 oct. 2026, 10:00",
  addedAtLabel: "5 oct. 2026, 10:00",
};
const MISTRAL: ConnectionStatus = {
  provider: "mistral",
  last4: "9xQz",
  model: "mistral-small-latest",
  modelLabel: "Mistral Small",
  verifiedAtLabel: null,
  addedAtLabel: "5 oct. 2026, 10:00",
};

/** Le résumé de la clé, dont les 4 derniers caractères sont dans leur propre élément. */
const keySummary = (text: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);

afterEach(() => {
  cleanup();
  for (const fn of [selectWriter, connectProvider, testConnection, deleteConnection, refresh]) fn.mockReset();
});

const q2 = (label = "Claude") => screen.queryByRole("heading", { name: `2. Connecter ${label}` });
const group = () => screen.getByRole("radiogroup", { name: "1. Qui rédige le jour J ?" });
const values = () => within(group()).getAllByRole("radio").map((r) => r.getAttribute("value"));

describe("AiSetup — sans bandeau d'état", () => {
  it("ne devrait plus afficher le bandeau « rédigés par … » ni l'état « Prêt » / « À connecter »", () => {
    render(<AiSetup status={status({ saved: "team-claude", team: ["claude"] })} />);
    expect(screen.queryByText(/rédigés par/)).not.toBeInTheDocument();
    expect(screen.queryByText("Prêt")).not.toBeInTheDocument();
    expect(screen.queryByText("À connecter")).not.toBeInTheDocument();
    // Le choix en vigueur se lit sur la carte cochée.
    expect(screen.getByRole("radio", { name: "Claude, clé de l'équipe" })).toBeChecked();
  });
});

describe("AiSetup — question 1", () => {
  it("devrait proposer Sans IA puis Mistral, Gemini, Claude et OpenAI, sans clé d'équipe ni Ollama non configurés", () => {
    render(<AiSetup status={status()} />);
    expect(values()).toEqual(["free", "mistral", "gemini", "claude", "openai"]);
    expect(screen.getByRole("radio", { name: "Sans IA" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Ollama/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /clé de l'équipe/ })).not.toBeInTheDocument();
  });

  it("devrait proposer une carte « clé de l'équipe » par fournisseur configuré sur le serveur, après Sans IA", () => {
    render(<AiSetup status={status({ team: ["mistral", "openai"] })} />);
    expect(values()).toEqual(["free", "team-mistral", "team-openai", "mistral", "gemini", "claude", "openai"]);
    expect(screen.getByRole("radio", { name: "Mistral, clé de l'équipe" })).toHaveAccessibleDescription("Clé fournie par votre équipe.");
  });

  it("devrait annoncer que Claude est facturé à l'usage sur le compte Anthropic, pas par l'abonnement Claude.ai", () => {
    render(<AiSetup status={status()} />);
    expect(screen.getByRole("radio", { name: "Claude" })).toHaveAccessibleDescription("Quelques centimes par diaporama.");
    const card = screen.getByRole("radio", { name: "Claude" }).closest("[data-engine-card]") as HTMLElement;
    expect(within(card).getByText(/facturés à l'usage sur votre compte Anthropic/)).toBeInTheDocument();
    expect(within(card).getByText(/abonnement Claude\.ai \(Pro, Max\) ne donne pas de crédits API/)).toBeInTheDocument();
  });

  it("devrait présenter Mistral avec son palier gratuit, son hébergement dans l'UE et l'entraînement sur les données", () => {
    render(<AiSetup status={status()} />);
    const radio = screen.getByRole("radio", { name: "Mistral" });
    expect(radio).toHaveAccessibleDescription("Palier gratuit, hébergé dans l'UE.");
    const card = within(radio.closest("[data-engine-card]") as HTMLElement);
    expect(card.getByText(/hébergé dans l'Union européenne/)).toBeInTheDocument();
    expect(card.getByText(/entraînement sur vos données activé par défaut/)).toBeInTheDocument();
  });

  it("devrait proposer le modèle local en dernier quand le serveur le configure", () => {
    render(<AiSetup status={status({ ollama: { reachable: true, models: ["mistral"], selectedModel: null } })} />);
    expect(screen.getByRole("radio", { name: "Modèle local (Ollama)" })).toBeEnabled();
    expect(values().at(-1)).toBe("ollama");
  });

  it("devrait expliquer un modèle local injoignable, sans commande d'administration", () => {
    render(<AiSetup status={status({ ollama: { reachable: false, models: [], selectedModel: null } })} />);
    const radio = screen.getByRole("radio", { name: "Modèle local (Ollama)" });
    expect(radio).toBeDisabled();
    expect(radio).toHaveAccessibleDescription(/ne répond pas pour le moment/);
    expect(document.body.textContent).not.toMatch(/ollama (serve|pull)|README|clé du serveur|moteur de rédaction/);
  });

  it("ne devrait proposer aucun bouton d'enregistrement quand le choix coché est déjà enregistré", () => {
    render(<AiSetup status={status({ saved: "free" })} />);
    expect(screen.queryByRole("button", { name: /^Choisir/ })).not.toBeInTheDocument();
  });

  it("ne devrait rien cocher d'invisible quand la clé d'équipe enregistrée n'est plus proposée", () => {
    render(<AiSetup status={status({ saved: "team-gemini" })} />);
    expect(screen.getByRole("radio", { name: "Sans IA" })).toBeChecked();
  });

  it("devrait enregistrer « Sans IA » et l'annoncer", async () => {
    selectWriter.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "claude", connections: [CLAUDE] })} />);
    await user.click(screen.getByRole("radio", { name: "Sans IA" }));
    await user.click(screen.getByRole("button", { name: "Choisir Sans IA" }));
    expect(selectWriter).toHaveBeenCalledWith({ engine: "free" });
    expect(await screen.findByText("Choix enregistré : Sans IA.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Choisir Sans IA" })).not.toBeInTheDocument();
  });

  it("devrait enregistrer la clé de l'équipe d'un fournisseur, sans demander de clé", async () => {
    selectWriter.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ team: ["mistral"] })} />);
    await user.click(screen.getByRole("radio", { name: "Mistral, clé de l'équipe" }));
    expect(q2("Mistral")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choisir Mistral, clé de l'équipe" }));
    expect(selectWriter).toHaveBeenCalledWith({ engine: "mistral", keySource: "server" });
    expect(await screen.findByText("Choix enregistré : Mistral, clé de l'équipe.")).toBeInTheDocument();
  });

  it("devrait enregistrer le modèle local choisi", async () => {
    selectWriter.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ ollama: { reachable: true, models: ["llama3.2", "mistral"], selectedModel: null } })} />);
    await user.click(screen.getByRole("radio", { name: "Modèle local (Ollama)" }));
    await user.selectOptions(screen.getByLabelText("Modèle"), "mistral");
    await user.click(screen.getByRole("button", { name: "Choisir ce modèle" }));
    expect(selectWriter).toHaveBeenCalledWith({ engine: "ollama", ollamaModel: "mistral" });
    expect(await screen.findByText("Choix enregistré : Ollama · mistral.")).toBeInTheDocument();
  });

  it("devrait afficher l'erreur renvoyée par le serveur", async () => {
    selectWriter.mockResolvedValue({ ok: false, error: "Le modèle local ne répond pas pour le moment. Réessayez plus tard." });
    const user = userEvent.setup();
    render(<AiSetup status={status({ ollama: { reachable: true, models: ["mistral"], selectedModel: null } })} />);
    await user.click(screen.getByRole("radio", { name: "Modèle local (Ollama)" }));
    await user.click(screen.getByRole("button", { name: "Choisir ce modèle" }));
    expect(await screen.findByText("Le modèle local ne répond pas pour le moment. Réessayez plus tard.")).toBeInTheDocument();
  });
});

describe("AiSetup — focus et erreurs (accessibilité)", () => {
  beforeEach(() => {
    // jsdom ne calcule pas de boîtes : focusLater exige getClientRects() non vide.
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
  });
  afterEach(() => vi.restoreAllMocks());

  it("devrait placer le focus sur le choix coché quand le bouton « Choisir … » disparaît après l'enregistrement", async () => {
    selectWriter.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "claude", connections: [CLAUDE] })} />);
    await user.click(screen.getByRole("radio", { name: "Sans IA" }));
    await user.click(screen.getByRole("button", { name: "Choisir Sans IA" }));
    expect(await screen.findByText("Choix enregistré : Sans IA.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choisir Sans IA" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole("radio", { name: "Sans IA" })).toHaveFocus());
  });

  it("devrait marquer le groupe invalide et le décrire par l'erreur « engine » renvoyée par le serveur", async () => {
    selectWriter.mockResolvedValue({
      ok: false,
      error: "Ce choix n'a pas pu être enregistré.",
      fieldErrors: { engine: ["Ce moteur n'est pas disponible sur ce serveur."] },
    });
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "claude", connections: [CLAUDE] })} />);
    expect(group()).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("radio", { name: "Sans IA" }));
    await user.click(screen.getByRole("button", { name: "Choisir Sans IA" }));
    await vi.waitFor(() => expect(group()).toHaveAttribute("aria-invalid", "true"));
    expect(group()).toHaveAccessibleDescription(/Ce moteur n'est pas disponible sur ce serveur\./);
  });
});

describe("AiSetup — question 2", () => {
  it("devrait masquer « Connecter Claude » tant que Sans IA est coché", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "free" })} />);
    expect(q2()).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Claude" }));
    expect(q2()).toBeInTheDocument();
    // Sans clé : on connecte Claude par « Vérifier et activer », pas par « Choisir Claude ».
    expect(screen.queryByRole("button", { name: "Choisir Claude" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vérifier et activer" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Sans IA" }));
    expect(q2()).not.toBeInTheDocument();
  });

  it("devrait proposer « Choisir Claude » quand une clé existe déjà", async () => {
    selectWriter.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "free", connections: [CLAUDE] })} />);
    await user.click(screen.getByRole("radio", { name: "Claude" }));
    expect(keySummary("Clé •••• 4f2a · ajoutée le 5 oct. 2026, 10:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choisir Claude" }));
    expect(selectWriter).toHaveBeenCalledWith({ engine: "claude", keySource: "user" });
    expect(await screen.findByText("Choix enregistré : Claude.")).toBeInTheDocument();
  });

  it("devrait connecter Mistral : avertissement Privacy, puis choix enregistré après « Vérifier et activer »", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "mistral", last4: "ZZZZ", model: "mistral-large-latest" } });
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "free" })} />);
    await user.click(screen.getByRole("radio", { name: "Mistral" }));
    expect(q2("Mistral")).toBeInTheDocument();
    expect(screen.getByText("Étape 2 affichée plus bas : connectez Mistral.")).toBeInTheDocument();
    expect(screen.getByText(/Désactivez l'entraînement sur vos données dans Admin Console › Privacy/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choisir Mistral" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Clé API Mistral"), `${"b".repeat(28)}ZZZZ`);
    await user.click(screen.getByRole("button", { name: "Vérifier et activer" }));
    expect(await screen.findByText("Mistral est activé : clé •••• ZZZZ vérifiée et enregistrée.")).toBeInTheDocument();
    expect(connectProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: "mistral", activate: true }));
    expect(selectWriter).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Choisir/ })).not.toBeInTheDocument();
  });
});

describe("AiSetup — Mes connexions", () => {
  const section = () => screen.getByRole("region", { name: "Mes connexions" });
  const row = (label: string) =>
    within(section())
      .getAllByRole("listitem")
      .find((li) => li.querySelector("p")?.textContent === label) as HTMLElement;

  it("devrait proposer de connecter une clé quand aucune n'est enregistrée", () => {
    render(<AiSetup status={status()} />);
    expect(within(section()).getByText(/Aucune clé enregistrée/)).toBeInTheDocument();
    expect(within(section()).queryByRole("list")).not.toBeInTheDocument();
  });

  it("devrait lister les clés enregistrées : fournisseur, 4 derniers caractères, modèle, vérification, « Active »", () => {
    render(<AiSetup status={status({ saved: "mistral", connections: [CLAUDE, MISTRAL] })} />);
    expect(within(section()).getAllByRole("listitem")).toHaveLength(2);
    expect(row("Claude")).toHaveTextContent("Clé •••• 4f2a · Claude Opus 5.5 · vérifiée le 6 oct. 2026, 10:00");
    expect(row("Mistral")).toHaveTextContent("Clé •••• 9xQz · Mistral Small · pas encore vérifiée");
    expect(within(row("Mistral")).getByText("Active")).toBeInTheDocument();
    expect(within(row("Mistral")).queryByRole("button", { name: /^Utiliser/ })).not.toBeInTheDocument();
    expect(within(row("Claude")).getByRole("button", { name: "Utiliser Claude" })).toBeInTheDocument();
  });

  it("devrait activer une autre connexion avec « Utiliser »", async () => {
    selectWriter.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "mistral", connections: [CLAUDE, MISTRAL] })} />);
    await user.click(within(row("Claude")).getByRole("button", { name: "Utiliser Claude" }));
    expect(selectWriter).toHaveBeenCalledWith({ engine: "claude", keySource: "user" });
    expect(await within(section()).findByText("Choix enregistré : Claude.")).toBeInTheDocument();
    expect(within(row("Claude")).getByText("Active")).toBeInTheDocument();
    expect(within(row("Mistral")).getByRole("button", { name: "Utiliser Mistral" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Claude" })).toBeChecked();
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait supprimer une connexion après confirmation", async () => {
    deleteConnection.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "mistral", connections: [CLAUDE, MISTRAL] })} />);
    await user.click(screen.getByRole("button", { name: "Supprimer la clé Mistral" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer la clé Mistral ?" });
    expect(dialog).toHaveTextContent("Mistral rédige le jour J : choisissez ensuite un autre rédacteur.");
    await user.click(within(dialog).getByRole("button", { name: "Supprimer la clé" }));
    await vi.waitFor(() => expect(deleteConnection).toHaveBeenCalledWith({ provider: "mistral" }));
    expect(await within(section()).findByText("Clé Mistral supprimée.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait ouvrir le remplacement de la clé dans la question 2 avec « Remplacer »", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "free", connections: [CLAUDE] })} />);
    expect(q2()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remplacer la clé Claude" }));
    expect(screen.getByRole("radio", { name: "Claude" })).toBeChecked();
    expect(q2()).toBeInTheDocument();
    expect(screen.getByLabelText("Clé API Anthropic")).toBeInTheDocument();
  });
});

describe("AiSetup — cartes de choix", () => {
  const card = (label: string) => screen.getByRole("radio", { name: label }).closest("[data-engine-card]") as HTMLElement;

  it("devrait présenter chaque choix en carte, avec son détail écrit dedans (résultat, coût, données)", () => {
    render(<AiSetup status={status({ team: ["gemini"], ollama: { reachable: false, models: [], selectedModel: null } })} />);
    const labels = ["Sans IA", "Gemini, clé de l'équipe", "Mistral", "Gemini", "Claude", "OpenAI", "Modèle local (Ollama)"];
    for (const label of labels) {
      const c = within(card(label));
      expect(c.getByText("Ce que vous obtenez")).toBeInTheDocument();
      expect(c.getByText("Coût")).toBeInTheDocument();
      expect(c.getByText("Vos données")).toBeInTheDocument();
    }
    expect(within(card("Claude")).getByText(/abonnement Claude\.ai/)).toBeInTheDocument();
    expect(within(card("OpenAI")).getByText(/abonnement ChatGPT/)).toBeInTheDocument();
    expect(within(card("Gemini, clé de l'équipe")).getByText(/facturé à l'équipe/)).toBeInTheDocument();
    // Plus de bouton « i » pour les choix : le détail est dans la carte.
    expect(screen.queryByRole("button", { name: /^En savoir plus : (Sans IA|Claude)/ })).not.toBeInTheDocument();
  });

  it("devrait garder le nom du radio court (le détail ne s'ajoute pas à son nom)", () => {
    render(<AiSetup status={status()} />);
    expect(screen.getByRole("radio", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Sans IA" })).toBeInTheDocument();
  });

  it("devrait cocher le choix quand on clique n'importe où dans sa carte", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "free" })} />);
    await user.click(within(card("Claude")).getByText("Vos données"));
    expect(screen.getByRole("radio", { name: "Claude" })).toBeChecked();
    expect(card("Claude")).toHaveAttribute("data-checked", "true");
  });

  it("ne devrait pas cocher un choix indisponible en cliquant sa carte", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "free", ollama: { reachable: false, models: [], selectedModel: null } })} />);
    await user.click(within(card("Modèle local (Ollama)")).getByText("Coût"));
    expect(screen.getByRole("radio", { name: "Sans IA" })).toBeChecked();
  });

  it("devrait replier le détail derrière « Afficher le détail » (téléphone), relié au détail", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status()} />);
    const toggle = screen.getByRole("button", { name: "Afficher le détail : Claude" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const details = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(details).toHaveAttribute("data-open", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Masquer le détail : Claude" })).toHaveAttribute("aria-expanded", "true");
    expect(details).toHaveAttribute("data-open", "true");
    // Déplier le détail ne coche pas le choix.
    expect(screen.getByRole("radio", { name: "Claude" })).not.toBeChecked();
  });
});

describe("AiSetup — apparition de la question 2", () => {
  it("devrait faire apparaître « Connecter Claude » en douceur quand on coche Claude", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status({ saved: "free" })} />);
    await user.click(screen.getByRole("radio", { name: "Claude" }));
    const section = q2()!.closest("section")!;
    expect(section.parentElement).toHaveAttribute("data-reveal", "enter");
    // Annoncée aux lecteurs d'écran : la suite apparaît plus bas.
    expect(screen.getByText("Étape 2 affichée plus bas : connectez Claude.")).toBeInTheDocument();
  });

  it("ne devrait pas animer « Connecter Claude » déjà visible au chargement", () => {
    render(<AiSetup status={status({ saved: "claude", connections: [CLAUDE] })} />);
    const section = q2()!.closest("section")!;
    expect(section.parentElement).not.toHaveAttribute("data-reveal", "enter");
  });
});
