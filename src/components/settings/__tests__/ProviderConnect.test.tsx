import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionStatus } from "@/components/settings/ai-status";
import type { ActionResult } from "@/server/actions/result";

const connectProvider = vi.fn();
const deleteConnection = vi.fn();
const testConnection = vi.fn();
const setConnectionModel = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/settings", () => ({
  connectProvider: (...args: unknown[]) => connectProvider(...args),
  deleteConnection: (...args: unknown[]) => deleteConnection(...args),
  testConnection: (...args: unknown[]) => testConnection(...args),
  setConnectionModel: (...args: unknown[]) => setConnectionModel(...args),
  selectWriter: vi.fn(),
}));

const { ProviderConnect } = await import("@/components/settings/ProviderConnect");

const GEMINI_KEY: ConnectionStatus = {
  provider: "gemini",
  last4: "4f2a",
  model: "gemini-2.5-flash",
  modelLabel: "Gemini 2.5 Flash",
  verifiedAtLabel: "6 oct. 2026, 10:00",
  addedAtLabel: "5 oct. 2026, 10:00",
};
const MISTRAL_KEY: ConnectionStatus = {
  provider: "mistral",
  last4: "9xQz",
  model: "mistral-large-latest",
  modelLabel: "Mistral Large",
  verifiedAtLabel: null,
  addedAtLabel: "5 oct. 2026, 10:00",
};
const VALID_KEY = `AIza${"a".repeat(32)}AAAA`;
const MISTRAL_VALUE = `${"b".repeat(28)}ZZZZ`;

/** Le résumé de la clé, dont les 4 derniers caractères sont dans leur propre élément. */
const keySummary = (text: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);

afterEach(() => {
  cleanup();
  for (const fn of [connectProvider, deleteConnection, testConnection, setConnectionModel, refresh]) fn.mockReset();
});

const field = () => screen.getByLabelText("Clé API Gemini");
const submit = () => screen.getByRole("button", { name: "Vérifier et activer" });

describe("ProviderConnect — Gemini sans clé", () => {
  it("devrait proposer le lien vers la console, le champ, la liste des modèles et « Vérifier et activer », sans liste numérotée", () => {
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Google AI Studio, rubrique API Keys/ });
    expect(link).toHaveAttribute("href", "https://aistudio.google.com/apikey");
    expect(link).toHaveAttribute("target", "_blank");
    expect(field()).toHaveAttribute("autocomplete", "off");
    // Le format reste dit au lecteur d'écran, en description du champ.
    expect(field()).toHaveAccessibleDescription(/commence par « AIza »/);
    expect(submit()).toBeInTheDocument();
    expect(screen.getByLabelText("Modèle")).toHaveValue("gemini-2.5-flash");
    // Ni avertissement Privacy (propre à Mistral), ni rappel d'abonnement (Claude, OpenAI : plus proposés).
    expect(screen.queryByText(/Admin Console › Privacy|abonnement/)).not.toBeInTheDocument();
  });

  it("devrait détailler format, palier gratuit et sécurité de la clé derrière le bouton « i »", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "En savoir plus : Votre clé API" }));
    const panel = await screen.findByRole("dialog", { name: "Votre clé API" });
    expect(within(panel).getByText((_, el) => el?.tagName === "DD" && /commence par « AIza »/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(within(panel).getByText(/palier gratuit/)).toBeInTheDocument();
    expect(within(panel).getByText(/chiffrée et n'est jamais réaffichée/)).toBeInTheDocument();
  });

  it("devrait afficher sur le champ la forme refusée par le serveur, et y placer le focus", async () => {
    const message = "Ce n'est pas une clé API Gemini valide.";
    connectProvider.mockResolvedValue({ ok: false, error: message, fieldErrors: { apiKey: [message] } });
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), "AIza-court");
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(/pas une clé API Gemini valide/);
    await vi.waitFor(() => expect(field()).toHaveFocus());
  });

  it("devrait refuser un champ vide sans appeler le serveur", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    await user.click(submit());
    expect(await screen.findByText("Saisissez votre clé API Gemini.")).toBeInTheDocument();
    expect(connectProvider).not.toHaveBeenCalled();
  });

  it("devrait désactiver « Vérifier et activer » pendant l'envoi et ignorer un second clic", async () => {
    let resolve: (value: ActionResult<{ provider: string; last4: string; model: string }>) => void = () => undefined;
    connectProvider.mockImplementation(() => new Promise((r) => (resolve = r)));
    const onActivated = vi.fn();
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={onActivated} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    const busy = screen.getByRole("button", { name: /Vérification de la clé/ });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    await user.click(busy);
    expect(connectProvider).toHaveBeenCalledTimes(1);
    expect(connectProvider).toHaveBeenCalledWith({ provider: "gemini", apiKey: VALID_KEY, model: "gemini-2.5-flash", activate: true });

    await act(async () => resolve({ ok: true, data: { provider: "gemini", last4: "AAAA", model: "gemini-2.5-flash" } }));
    expect(await screen.findByText("Gemini est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
    expect(onActivated).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    expect(field()).toHaveValue("");
  });

  it("devrait placer le focus sur « Remplacer » quand la clé activée apparaît (après rafraîchissement)", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "gemini", last4: "AAAA", model: "gemini-2.5-flash" } });
    const user = userEvent.setup();
    const { rerender } = render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByText("Gemini est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
    // router.refresh() : la page renvoie la clé enregistrée, le formulaire (et son bouton focalisé) disparaît.
    rerender(<ProviderConnect provider="gemini" connection={{ ...GEMINI_KEY, last4: "AAAA" }} onActivated={vi.fn()} />);
    expect(screen.queryByLabelText("Clé API Gemini")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remplacer" })).toHaveFocus();
  });

  it("ne devrait pas voler le focus quand la clé apparaît sans activation dans cette page", () => {
    const { rerender } = render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    rerender(<ProviderConnect provider="gemini" connection={GEMINI_KEY} onActivated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remplacer" })).not.toHaveFocus();
  });

  it("devrait afficher le refus de Gemini sur le champ, sans activer", async () => {
    const message = "Cette clé est refusée par Gemini. Vérifiez-la ou créez-en une nouvelle sur aistudio.google.com.";
    connectProvider.mockResolvedValue({ ok: false, error: message, fieldErrors: { apiKey: [message] } });
    const onActivated = vi.fn();
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={onActivated} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette clé est refusée par Gemini");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(onActivated).not.toHaveBeenCalled();
  });

  it("devrait donner l'heure à laquelle réessayer quand le quota de vérification est atteint", async () => {
    connectProvider.mockResolvedValue({
      ok: false,
      error: "Trop de vérifications de clé en peu de temps. Réessayez dans 2 min.",
      retryAfterSeconds: 120,
    });
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Trop de vérifications de clé en peu de temps\. Réessayez à \d{2}:\d{2}\./);
  });

  it("devrait signaler une connexion interrompue", async () => {
    connectProvider.mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("La connexion a été interrompue. Réessayez.");
  });
});

describe("ProviderConnect — Gemini avec une clé", () => {
  it("devrait tester la connexion de la clé enregistrée et annoncer le résultat", async () => {
    testConnection.mockResolvedValue({ ok: true, data: { provider: "gemini", model: "gemini-2.5-flash", verifiedAt: "2026-10-07T08:00:00.000Z" } });
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={GEMINI_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(testConnection).toHaveBeenCalledWith({ provider: "gemini" });
    expect(await screen.findByText(/Connexion à Gemini réussie \(modèle gemini-2\.5-flash\)/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait afficher la clé désormais refusée renvoyée par le test", async () => {
    const message = "Cette clé est refusée par Gemini. Vérifiez-la ou créez-en une nouvelle sur aistudio.google.com.";
    testConnection.mockResolvedValue({ ok: false, error: message });
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={GEMINI_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("devrait résumer la clé sans le champ, puis le révéler avec « Remplacer »", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={GEMINI_KEY} onActivated={vi.fn()} />);
    expect(keySummary("Clé •••• 4f2a · ajoutée le 5 oct. 2026, 10:00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Clé API Gemini")).not.toBeInTheDocument();
    const replace = screen.getByRole("button", { name: "Remplacer" });
    expect(replace).toHaveAttribute("aria-expanded", "false");
    await user.click(replace);
    expect(replace).toHaveAttribute("aria-expanded", "true");
    expect(field()).toBeInTheDocument();
    await vi.waitFor(() => expect(field()).toHaveFocus());
  });

  it("devrait ouvrir directement le remplacement quand la page le demande (« Remplacer » de Mes connexions)", async () => {
    const getRects = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    try {
      render(<ProviderConnect provider="gemini" connection={GEMINI_KEY} onActivated={vi.fn()} startReplacing />);
      expect(screen.getByRole("button", { name: "Remplacer" })).toHaveAttribute("aria-expanded", "true");
      await vi.waitFor(() => expect(field()).toHaveFocus());
    } finally {
      getRects.mockRestore();
    }
  });

  it("devrait placer le focus sur « Remplacer » quand le formulaire de remplacement disparaît après activation", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "gemini", last4: "AAAA", model: "gemini-2.5-flash" } });
    const getRects = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    try {
      const user = userEvent.setup();
      render(<ProviderConnect provider="gemini" connection={GEMINI_KEY} onActivated={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Remplacer" }));
      await user.type(field(), VALID_KEY);
      await user.click(submit());
      expect(await screen.findByText("Gemini est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Clé API Gemini")).not.toBeInTheDocument();
      await vi.waitFor(() => expect(screen.getByRole("button", { name: "Remplacer" })).toHaveFocus());
    } finally {
      getRects.mockRestore();
    }
  });

  it("devrait supprimer la clé après confirmation", async () => {
    deleteConnection.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={GEMINI_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Supprimer ma clé" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer votre clé ?" });
    expect(dialog).toHaveTextContent("Elle reste valable dans Google AI Studio.");
    await user.click(screen.getByRole("button", { name: "Supprimer la clé" }));
    await vi.waitFor(() => expect(deleteConnection).toHaveBeenCalledWith({ provider: "gemini" }));
    expect(await screen.findByText("Votre clé a été supprimée.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("ProviderConnect — Mistral", () => {
  const mistralField = () => screen.getByLabelText("Clé API Mistral");

  it("devrait proposer la console Mistral, la liste fermée des modèles et l'avertissement Privacy du palier gratuit", () => {
    render(<ProviderConnect provider="mistral" connection={null} onActivated={vi.fn()} />);
    expect(screen.getByRole("link", { name: /console Mistral/ })).toHaveAttribute("href", "https://console.mistral.ai/api-keys");
    expect(screen.getByText(/Désactivez l'entraînement sur vos données dans Admin Console › Privacy/)).toBeInTheDocument();
    const model = screen.getByLabelText("Modèle");
    expect(within(model).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual([
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
    ]);
    expect(model).toHaveValue("mistral-large-latest");
  });

  it("devrait connecter Mistral avec le modèle choisi et l'activer", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "mistral", last4: "ZZZZ", model: "mistral-small-latest" } });
    const onActivated = vi.fn();
    const user = userEvent.setup();
    render(<ProviderConnect provider="mistral" connection={null} onActivated={onActivated} />);
    await user.type(mistralField(), MISTRAL_VALUE);
    await user.selectOptions(screen.getByLabelText("Modèle"), "mistral-small-latest");
    await user.click(submit());
    expect(connectProvider).toHaveBeenCalledWith({ provider: "mistral", apiKey: MISTRAL_VALUE, model: "mistral-small-latest", activate: true });
    expect(await screen.findByText("Mistral est activé : clé •••• ZZZZ vérifiée et enregistrée.")).toBeInTheDocument();
    expect(onActivated).toHaveBeenCalledTimes(1);
  });

  it("devrait refuser un champ vide sans appeler le serveur", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="mistral" connection={null} onActivated={vi.fn()} />);
    await user.click(submit());
    expect(await screen.findByText("Saisissez votre clé API Mistral.")).toBeInTheDocument();
    expect(connectProvider).not.toHaveBeenCalled();
  });

  it("devrait afficher le refus de Mistral renvoyé par le serveur sur le champ", async () => {
    const message = "Cette clé est refusée par Mistral. Vérifiez-la ou créez-en une nouvelle sur console.mistral.ai.";
    connectProvider.mockResolvedValue({ ok: false, error: message, fieldErrors: { apiKey: [message] } });
    const user = userEvent.setup();
    render(<ProviderConnect provider="mistral" connection={null} onActivated={vi.fn()} />);
    await user.type(mistralField(), MISTRAL_VALUE);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette clé est refusée par Mistral");
    expect(mistralField()).toHaveAttribute("aria-invalid", "true");
  });

  it("devrait changer le modèle d'une clé enregistrée", async () => {
    setConnectionModel.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<ProviderConnect provider="mistral" connection={MISTRAL_KEY} onActivated={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Modèle"), "mistral-medium-latest");
    expect(setConnectionModel).toHaveBeenCalledWith({ provider: "mistral", model: "mistral-medium-latest" });
    expect(await screen.findByText("Modèle enregistré : Mistral Medium.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait garder le modèle de la clé quand on la remplace", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "mistral", last4: "ZZZZ", model: "mistral-small-latest" } });
    const user = userEvent.setup();
    render(<ProviderConnect provider="mistral" connection={{ ...MISTRAL_KEY, model: "mistral-small-latest" }} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Remplacer" }));
    await user.type(mistralField(), MISTRAL_VALUE);
    await user.click(submit());
    expect(connectProvider).toHaveBeenCalledWith({ provider: "mistral", apiKey: MISTRAL_VALUE, model: "mistral-small-latest", activate: true });
  });
});

describe("ProviderConnect — Gemini, modèle", () => {
  it("devrait connecter Gemini avec le modèle choisi", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "gemini", last4: "AAAA", model: "gemini-2.5-pro" } });
    const user = userEvent.setup();
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.selectOptions(screen.getByLabelText("Modèle"), "gemini-2.5-pro");
    await user.click(submit());
    expect(connectProvider).toHaveBeenCalledWith({ provider: "gemini", apiKey: VALID_KEY, model: "gemini-2.5-pro", activate: true });
  });
});
