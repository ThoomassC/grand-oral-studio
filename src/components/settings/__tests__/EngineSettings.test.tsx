import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@/components/settings/EngineSettings";

const setEngine = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/settings", () => ({
  setAiEngine: (...args: unknown[]) => setEngine(...args),
  saveAnthropicApiKey: vi.fn(),
  deleteAnthropicApiKey: vi.fn(),
  testAnthropicApiKey: vi.fn(),
}));

const { EngineSettings } = await import("@/components/settings/EngineSettings");

function status(overrides: Partial<EngineStatus> = {}, ollama: Partial<EngineStatus["available"]["ollama"]> = {}): EngineStatus {
  return {
    selected: null,
    effective: "free",
    ...overrides,
    available: {
      claude: false,
      free: true,
      ...overrides.available,
      ollama: { configured: false, reachable: false, models: [], selectedModel: null, ...ollama },
    },
  };
}

afterEach(() => {
  cleanup();
  setEngine.mockReset();
  refresh.mockReset();
});

describe("EngineSettings", () => {
  it("devrait présenter trois moteurs dans un groupe nommé, avec le moteur utilisé et le défaut", () => {
    render(<EngineSettings status={status()} />);
    const group = screen.getByRole("radiogroup", { name: "Choix du moteur" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText(/Moteur utilisé :/)).toHaveTextContent("Gratuit (sans IA)");
    expect(screen.getByText(/Par défaut : Claude si une clé est disponible, sinon Gratuit/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Gratuit/ })).toBeChecked();
  });

  it("devrait désactiver Claude sans clé, avec l'explication et un lien vers la clé", () => {
    render(<EngineSettings status={status()} />);
    const claude = screen.getByRole("radio", { name: /Claude/ });
    expect(claude).toBeDisabled();
    expect(claude).toHaveAccessibleDescription(/clé API/);
    expect(screen.getByRole("link", { name: /Ajouter une clé API/ })).toHaveAttribute("href", "#cle-api");
  });

  it("devrait expliquer chaque état indisponible d'Ollama", () => {
    const { rerender } = render(<EngineSettings status={status()} />);
    expect(screen.getByText(/Ollama n'est pas configuré sur ce serveur/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Ollama/ })).toBeDisabled();

    rerender(<EngineSettings status={status({}, { configured: true })} />);
    expect(screen.getByText(/Ollama ne répond pas/)).toBeInTheDocument();

    rerender(<EngineSettings status={status({}, { configured: true, reachable: true })} />);
    expect(screen.getByText(/ollama pull mistral/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Ollama/ })).toBeDisabled();
  });

  it("devrait enregistrer Ollama avec le modèle choisi", async () => {
    setEngine.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(
      <EngineSettings
        status={status({}, { configured: true, reachable: true, models: ["llama3.2", "mistral"], selectedModel: null })}
      />,
    );
    await user.click(screen.getByRole("radio", { name: /Ollama/ }));
    await user.selectOptions(screen.getByLabelText("Modèle Ollama"), "mistral");
    await user.click(screen.getByRole("button", { name: "Enregistrer le moteur" }));
    expect(setEngine).toHaveBeenCalledWith({ engine: "ollama", ollamaModel: "mistral" });
    expect(await screen.findByText(/Moteur enregistré/)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("devrait afficher l'erreur de champ renvoyée par le serveur", async () => {
    setEngine.mockResolvedValue({
      ok: false,
      error: "Le moteur n'a pas pu être enregistré.",
      fieldErrors: { engine: ["Ajoutez d'abord votre clé API Anthropic pour utiliser Claude."] },
    });
    const user = userEvent.setup();
    render(<EngineSettings status={status({ available: { claude: true, free: true, ollama: { configured: false, reachable: false, models: [], selectedModel: null } } })} />);
    await user.click(screen.getByRole("radio", { name: /Claude/ }));
    await user.click(screen.getByRole("button", { name: "Enregistrer le moteur" }));
    expect(setEngine).toHaveBeenCalledWith({ engine: "claude" });
    expect(await screen.findByText(/Ajoutez d'abord votre clé API/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Le moteur n'a pas pu être enregistré.");
  });

  it("devrait préfixer chaque raison d'indisponibilité par « Indisponible : »", () => {
    render(<EngineSettings status={status({}, { configured: true })} />);
    expect(screen.getByRole("radio", { name: /Ollama/ })).toHaveAccessibleDescription(/Indisponible : Ollama ne répond pas/);
    expect(screen.getByRole("radio", { name: /Claude/ })).toHaveAccessibleDescription(/Indisponible : aucune clé API/);
  });

  it("devrait ramener le focus sur le premier moteur disponible si le choix coché est indisponible", async () => {
    const user = userEvent.setup();
    // Claude enregistré, puis devenu indisponible (clé supprimée) : coché mais désactivé.
    render(<EngineSettings status={status({ selected: "claude", effective: "claude" })} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer le moteur" }));
    expect((await screen.findAllByText(/Choisissez un moteur disponible/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: /Gratuit/ })).toHaveFocus();
    expect(setEngine).not.toHaveBeenCalled();
  });
});
