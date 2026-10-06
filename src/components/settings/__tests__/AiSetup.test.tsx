import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSetupStatus } from "@/components/settings/ai-status";

const setAiEngine = vi.fn();
const activateClaude = vi.fn();
const testAnthropicApiKey = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/settings", () => ({
  setAiEngine: (...args: unknown[]) => setAiEngine(...args),
  activateClaude: (...args: unknown[]) => activateClaude(...args),
  deleteAnthropicApiKey: vi.fn(),
  testAnthropicApiKey: (...args: unknown[]) => testAnthropicApiKey(...args),
}));

const { AiSetup } = await import("@/components/settings/AiSetup");

function status(overrides: Partial<AiSetupStatus> = {}, claude: Partial<AiSetupStatus["claude"]> = {}): AiSetupStatus {
  return {
    selected: null,
    effective: "free",
    ollama: null,
    ...overrides,
    claude: { available: false, source: "none", userKey: null, ...claude },
  };
}

const WITH_USER_KEY = { available: true, source: "user", userKey: { last4: "4f2a", addedAtLabel: "5 oct. 2026, 10:00" } } as const;

/** Le résumé de la clé, dont les 4 derniers caractères sont dans leur propre élément. */
const keySummary = (text: string) =>
  screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);

afterEach(() => {
  cleanup();
  for (const fn of [setAiEngine, activateClaude, testAnthropicApiKey, refresh]) fn.mockReset();
});

const q2 = () => screen.queryByRole("heading", { name: "2. Connecter Claude" });

describe("AiSetup — bandeau d'état", () => {
  it("devrait dire qui rédige et que c'est prêt, Sans IA", () => {
    render(<AiSetup status={status({ selected: "free" })} />);
    expect(screen.getByText(/Le jour J, vos diaporamas sont rédigés par/)).toHaveTextContent(
      "Le jour J, vos diaporamas sont rédigés par Sans IA.",
    );
    expect(screen.getByText("Prêt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tester" })).not.toBeInTheDocument();
  });

  it("devrait afficher « À connecter » quand Claude est choisi sans clé", () => {
    render(<AiSetup status={status({ selected: "claude", effective: "claude" })} />);
    expect(screen.getByText(/rédigés par/)).toHaveTextContent("rédigés par Claude.");
    expect(screen.getByText("À connecter")).toBeInTheDocument();
    expect(screen.queryByText("Prêt")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tester" })).not.toBeInTheDocument();
  });

  it("devrait proposer « Tester » avec une clé réelle et annoncer le résultat", async () => {
    testAnthropicApiKey.mockResolvedValue({ ok: true, data: { source: "user", model: "claude-opus-5-5" } });
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "claude", effective: "claude" }, WITH_USER_KEY)} />);
    await user.click(screen.getByRole("button", { name: "Tester" }));
    expect(testAnthropicApiKey).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Connexion à Claude réussie/)).toBeInTheDocument();
  });

  it("ne devrait pas proposer « Tester » en démonstration", () => {
    render(<AiSetup status={status({ selected: "claude", effective: "mock" }, { available: true, source: "mock" })} />);
    expect(screen.getByText(/rédigés par/)).toHaveTextContent("rédigés par Démo (contenus factices).");
    expect(screen.queryByRole("button", { name: "Tester" })).not.toBeInTheDocument();
  });
});

describe("AiSetup — question 1", () => {
  it("devrait proposer Sans IA et Claude dans un groupe nommé par la question, sans Ollama non configuré", () => {
    render(<AiSetup status={status()} />);
    const group = screen.getByRole("radiogroup", { name: "1. Qui rédige le jour J ?" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["free", "claude"]);
    expect(screen.getByRole("radio", { name: "Sans IA" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Ollama/ })).not.toBeInTheDocument();
  });

  it("devrait annoncer que Claude est facturé à l'usage sur le compte Anthropic, pas par l'abonnement Claude.ai", () => {
    render(<AiSetup status={status()} />);
    expect(screen.getByRole("radio", { name: "Claude" })).toHaveAccessibleDescription("Quelques centimes par diaporama.");
    const card = screen.getByRole("radio", { name: "Claude" }).closest("[data-engine-card]") as HTMLElement;
    expect(within(card).getByText(/facturés à l'usage sur votre compte Anthropic/)).toBeInTheDocument();
    expect(within(card).getByText(/abonnement Claude\.ai \(Pro, Max\) ne donne pas de crédits API/)).toBeInTheDocument();
  });

  it("devrait proposer le modèle local quand le serveur le configure", () => {
    render(<AiSetup status={status({ ollama: { reachable: true, models: ["mistral"], selectedModel: null } })} />);
    expect(screen.getByRole("radio", { name: "Modèle local (Ollama)" })).toBeEnabled();
  });

  it("devrait expliquer un modèle local injoignable, sans commande d'administration", () => {
    render(<AiSetup status={status({ ollama: { reachable: false, models: [], selectedModel: null } })} />);
    const radio = screen.getByRole("radio", { name: "Modèle local (Ollama)" });
    expect(radio).toBeDisabled();
    expect(radio).toHaveAccessibleDescription(/ne répond pas pour le moment/);
    expect(document.body.textContent).not.toMatch(/ollama (serve|pull)|README|clé du serveur|moteur de rédaction/);
  });

  it("ne devrait proposer aucun bouton d'enregistrement quand le choix coché est déjà enregistré", () => {
    render(<AiSetup status={status({ selected: "free" })} />);
    expect(screen.queryByRole("button", { name: /^Choisir/ })).not.toBeInTheDocument();
  });

  it("devrait enregistrer « Sans IA » et l'annoncer", async () => {
    setAiEngine.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "claude", effective: "claude" }, WITH_USER_KEY)} />);
    await user.click(screen.getByRole("radio", { name: "Sans IA" }));
    await user.click(screen.getByRole("button", { name: "Choisir Sans IA" }));
    expect(setAiEngine).toHaveBeenCalledWith({ engine: "free" });
    expect(await screen.findByText("Choix enregistré : Sans IA.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Choisir Sans IA" })).not.toBeInTheDocument();
  });

  it("devrait enregistrer le modèle local choisi", async () => {
    setAiEngine.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ ollama: { reachable: true, models: ["llama3.2", "mistral"], selectedModel: null } })} />);
    await user.click(screen.getByRole("radio", { name: "Modèle local (Ollama)" }));
    await user.selectOptions(screen.getByLabelText("Modèle"), "mistral");
    await user.click(screen.getByRole("button", { name: "Choisir ce modèle" }));
    expect(setAiEngine).toHaveBeenCalledWith({ engine: "ollama", ollamaModel: "mistral" });
    expect(await screen.findByText("Choix enregistré : Ollama · mistral.")).toBeInTheDocument();
  });

  it("devrait afficher l'erreur renvoyée par le serveur", async () => {
    setAiEngine.mockResolvedValue({ ok: false, error: "Le modèle local ne répond pas pour le moment. Réessayez plus tard." });
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
    setAiEngine.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "claude", effective: "claude" }, WITH_USER_KEY)} />);
    await user.click(screen.getByRole("radio", { name: "Sans IA" }));
    await user.click(screen.getByRole("button", { name: "Choisir Sans IA" }));
    expect(await screen.findByText("Choix enregistré : Sans IA.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choisir Sans IA" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole("radio", { name: "Sans IA" })).toHaveFocus());
  });

  it("devrait marquer le groupe invalide et le décrire par l'erreur « engine » renvoyée par le serveur", async () => {
    setAiEngine.mockResolvedValue({
      ok: false,
      error: "Ce choix n'a pas pu être enregistré.",
      fieldErrors: { engine: ["Ce moteur n'est pas disponible sur ce serveur."] },
    });
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "claude", effective: "claude" }, WITH_USER_KEY)} />);
    const group = screen.getByRole("radiogroup", { name: "1. Qui rédige le jour J ?" });
    expect(group).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("radio", { name: "Sans IA" }));
    await user.click(screen.getByRole("button", { name: "Choisir Sans IA" }));
    await vi.waitFor(() => expect(group).toHaveAttribute("aria-invalid", "true"));
    expect(group).toHaveAccessibleDescription(/Ce moteur n'est pas disponible sur ce serveur\./);
  });
});

describe("AiSetup — question 2", () => {
  it("devrait masquer « Connecter Claude » tant que Sans IA est coché", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "free" })} />);
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
    setAiEngine.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "free" }, WITH_USER_KEY)} />);
    await user.click(screen.getByRole("radio", { name: "Claude" }));
    expect(keySummary("Clé •••• 4f2a · ajoutée le 5 oct. 2026, 10:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choisir Claude" }));
    expect(setAiEngine).toHaveBeenCalledWith({ engine: "claude" });
    expect(await screen.findByText("Choix enregistré : Claude.")).toBeInTheDocument();
  });

  it("devrait considérer Claude enregistré après « Vérifier et activer »", async () => {
    activateClaude.mockResolvedValue({ ok: true, data: { last4: "ZZZZ" } });
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "free" })} />);
    await user.click(screen.getByRole("radio", { name: "Claude" }));
    await user.type(screen.getByLabelText("Clé API Anthropic"), `sk-ant-api03-${"a".repeat(40)}ZZZZ`);
    await user.click(screen.getByRole("button", { name: "Vérifier et activer" }));
    expect(await screen.findByText("Claude est activé : clé •••• ZZZZ vérifiée et enregistrée.")).toBeInTheDocument();
    expect(setAiEngine).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Choisir/ })).not.toBeInTheDocument();
  });
});

describe("AiSetup — cartes de choix", () => {
  const card = (label: string) => screen.getByRole("radio", { name: label }).closest("[data-engine-card]") as HTMLElement;

  it("devrait présenter chaque choix en carte, avec son détail écrit dedans (résultat, coût, données)", () => {
    render(<AiSetup status={status({ ollama: { reachable: false, models: [], selectedModel: null } })} />);
    for (const label of ["Sans IA", "Claude", "Modèle local (Ollama)"]) {
      const c = within(card(label));
      expect(c.getByText("Ce que vous obtenez")).toBeInTheDocument();
      expect(c.getByText("Coût")).toBeInTheDocument();
      expect(c.getByText("Vos données")).toBeInTheDocument();
    }
    expect(within(card("Claude")).getByText(/abonnement Claude\.ai/)).toBeInTheDocument();
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
    render(<AiSetup status={status({ selected: "free" })} />);
    await user.click(within(card("Claude")).getByText("Vos données"));
    expect(screen.getByRole("radio", { name: "Claude" })).toBeChecked();
    expect(card("Claude")).toHaveAttribute("data-checked", "true");
  });

  it("ne devrait pas cocher un choix indisponible en cliquant sa carte", async () => {
    const user = userEvent.setup();
    render(<AiSetup status={status({ selected: "free", ollama: { reachable: false, models: [], selectedModel: null } })} />);
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
    render(<AiSetup status={status({ selected: "free" })} />);
    await user.click(screen.getByRole("radio", { name: "Claude" }));
    const section = q2()!.closest("section")!;
    expect(section.parentElement).toHaveAttribute("data-reveal", "enter");
    // Annoncée aux lecteurs d'écran : la suite apparaît plus bas.
    expect(screen.getByText("Étape 2 affichée plus bas : connectez Claude.")).toBeInTheDocument();
  });

  it("ne devrait pas animer « Connecter Claude » déjà visible au chargement", () => {
    render(<AiSetup status={status({ selected: "claude", effective: "claude" })} />);
    const section = q2()!.closest("section")!;
    expect(section.parentElement).not.toHaveAttribute("data-reveal", "enter");
  });
});
