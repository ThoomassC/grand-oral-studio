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

const CLAUDE_KEY: ConnectionStatus = {
  provider: "claude",
  last4: "4f2a",
  model: "claude-opus-5-5",
  modelLabel: "Claude Opus 5.5",
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
const VALID_KEY = `sk-ant-api03-${"a".repeat(40)}AAAA`;
const MISTRAL_VALUE = `${"b".repeat(28)}ZZZZ`;

/** Le résumé de la clé, dont les 4 derniers caractères sont dans leur propre élément. */
const keySummary = (text: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);

afterEach(() => {
  cleanup();
  for (const fn of [connectProvider, deleteConnection, testConnection, setConnectionModel, refresh]) fn.mockReset();
});

const field = () => screen.getByLabelText("Clé API Anthropic");
const submit = () => screen.getByRole("button", { name: "Vérifier et activer" });

describe("ProviderConnect — Claude sans clé", () => {
  it("devrait proposer le lien vers la console, le champ et « Vérifier et activer », sans liste numérotée", () => {
    render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /console Anthropic, rubrique API Keys/ });
    expect(link).toHaveAttribute("href", "https://console.anthropic.com/settings/keys");
    expect(link).toHaveAttribute("target", "_blank");
    expect(field()).toHaveAttribute("autocomplete", "off");
    // Le format reste dit au lecteur d'écran, en description du champ.
    expect(field()).toHaveAccessibleDescription(/commence par « sk-ant- »/);
    expect(submit()).toBeInTheDocument();
    // Un seul modèle proposé : pas de liste à choisir.
    expect(screen.queryByLabelText("Modèle")).not.toBeInTheDocument();
  });

  it("devrait rappeler qu'un abonnement Claude.ai ne donne pas accès à l'API", () => {
    render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    expect(screen.getByText(/abonnement Claude\.ai ne donne pas accès à l'API/)).toBeInTheDocument();
  });

  it("devrait détailler format, crédits et sécurité de la clé derrière le bouton « i »", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "En savoir plus : Votre clé API" }));
    const panel = await screen.findByRole("dialog", { name: "Votre clé API" });
    expect(within(panel).getByText((_, el) => el?.tagName === "DD" && /commence par « sk-ant- »/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(within(panel).getByText(/rubrique Billing/)).toBeInTheDocument();
    expect(within(panel).getByText(/chiffrée et n'est jamais réaffichée/)).toBeInTheDocument();
  });

  it("devrait refuser un format invalide sans appeler le serveur, et placer le focus sur le champ", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), "sk-ant-court");
    await user.click(submit());
    expect(await screen.findByText("La clé saisie n'a pas le bon format.")).toBeInTheDocument();
    expect(screen.getByText("Cette clé est trop courte : copiez-la en entier.")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(/trop courte/);
    await vi.waitFor(() => expect(field()).toHaveFocus());
    expect(connectProvider).not.toHaveBeenCalled();
  });

  it("devrait refuser un champ vide sans appeler le serveur", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    await user.click(submit());
    expect(await screen.findByText("Saisissez votre clé API Anthropic.")).toBeInTheDocument();
    expect(connectProvider).not.toHaveBeenCalled();
  });

  it("devrait désactiver « Vérifier et activer » pendant l'envoi et ignorer un second clic", async () => {
    let resolve: (value: ActionResult<{ provider: string; last4: string; model: string }>) => void = () => undefined;
    connectProvider.mockImplementation(() => new Promise((r) => (resolve = r)));
    const onActivated = vi.fn();
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={null} onActivated={onActivated} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    const busy = screen.getByRole("button", { name: /Vérification de la clé/ });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    await user.click(busy);
    expect(connectProvider).toHaveBeenCalledTimes(1);
    expect(connectProvider).toHaveBeenCalledWith({ provider: "claude", apiKey: VALID_KEY, model: null, activate: true });

    await act(async () => resolve({ ok: true, data: { provider: "claude", last4: "AAAA", model: "claude-opus-5-5" } }));
    expect(await screen.findByText("Claude est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
    expect(onActivated).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    expect(field()).toHaveValue("");
  });

  it("devrait placer le focus sur « Remplacer » quand la clé activée apparaît (après rafraîchissement)", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "claude", last4: "AAAA", model: "claude-opus-5-5" } });
    const user = userEvent.setup();
    const { rerender } = render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByText("Claude est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
    // router.refresh() : la page renvoie la clé enregistrée, le formulaire (et son bouton focalisé) disparaît.
    rerender(<ProviderConnect provider="claude" connection={{ ...CLAUDE_KEY, last4: "AAAA" }} onActivated={vi.fn()} />);
    expect(screen.queryByLabelText("Clé API Anthropic")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remplacer" })).toHaveFocus();
  });

  it("ne devrait pas voler le focus quand la clé apparaît sans activation dans cette page", () => {
    const { rerender } = render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    rerender(<ProviderConnect provider="claude" connection={CLAUDE_KEY} onActivated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remplacer" })).not.toHaveFocus();
  });

  it("devrait afficher le refus d'Anthropic sur le champ, sans activer", async () => {
    const message = "Cette clé est refusée par Anthropic. Vérifiez-la ou créez-en une nouvelle sur console.anthropic.com.";
    connectProvider.mockResolvedValue({ ok: false, error: message, fieldErrors: { apiKey: [message] } });
    const onActivated = vi.fn();
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={null} onActivated={onActivated} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette clé est refusée par Anthropic");
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
    render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Trop de vérifications de clé en peu de temps\. Réessayez à \d{2}:\d{2}\./);
  });

  it("devrait signaler une connexion interrompue", async () => {
    connectProvider.mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={null} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("La connexion a été interrompue. Réessayez.");
  });
});

describe("ProviderConnect — Claude avec une clé", () => {
  it("devrait tester la connexion de la clé enregistrée et annoncer le résultat", async () => {
    testConnection.mockResolvedValue({ ok: true, data: { provider: "claude", model: "claude-opus-5-5", verifiedAt: "2026-10-07T08:00:00.000Z" } });
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={CLAUDE_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(testConnection).toHaveBeenCalledWith({ provider: "claude" });
    expect(await screen.findByText(/Connexion à Claude réussie \(modèle claude-opus-5-5\)/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("devrait afficher le crédit épuisé renvoyé par le test", async () => {
    const message = "Votre compte Anthropic n'a plus de crédit. Rechargez-le sur console.anthropic.com ou choisissez le moteur gratuit.";
    testConnection.mockResolvedValue({ ok: false, error: message });
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={CLAUDE_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("devrait résumer la clé sans le champ, puis le révéler avec « Remplacer »", async () => {
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={CLAUDE_KEY} onActivated={vi.fn()} />);
    expect(keySummary("Clé •••• 4f2a · ajoutée le 5 oct. 2026, 10:00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Clé API Anthropic")).not.toBeInTheDocument();
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
      render(<ProviderConnect provider="claude" connection={CLAUDE_KEY} onActivated={vi.fn()} startReplacing />);
      expect(screen.getByRole("button", { name: "Remplacer" })).toHaveAttribute("aria-expanded", "true");
      await vi.waitFor(() => expect(field()).toHaveFocus());
    } finally {
      getRects.mockRestore();
    }
  });

  it("devrait placer le focus sur « Remplacer » quand le formulaire de remplacement disparaît après activation", async () => {
    connectProvider.mockResolvedValue({ ok: true, data: { provider: "claude", last4: "AAAA", model: "claude-opus-5-5" } });
    const getRects = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    try {
      const user = userEvent.setup();
      render(<ProviderConnect provider="claude" connection={CLAUDE_KEY} onActivated={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: "Remplacer" }));
      await user.type(field(), VALID_KEY);
      await user.click(submit());
      expect(await screen.findByText("Claude est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Clé API Anthropic")).not.toBeInTheDocument();
      await vi.waitFor(() => expect(screen.getByRole("button", { name: "Remplacer" })).toHaveFocus());
    } finally {
      getRects.mockRestore();
    }
  });

  it("devrait supprimer la clé après confirmation", async () => {
    deleteConnection.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<ProviderConnect provider="claude" connection={CLAUDE_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Supprimer ma clé" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer votre clé ?" });
    expect(dialog).toHaveTextContent("Elle reste valable dans votre console Anthropic.");
    await user.click(screen.getByRole("button", { name: "Supprimer la clé" }));
    await vi.waitFor(() => expect(deleteConnection).toHaveBeenCalledWith({ provider: "claude" }));
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

describe("ProviderConnect — OpenAI et Gemini", () => {
  it("devrait rappeler qu'un abonnement ChatGPT ne donne pas accès à l'API", () => {
    render(<ProviderConnect provider="openai" connection={null} onActivated={vi.fn()} />);
    expect(screen.getByText(/abonnement ChatGPT ne donne pas accès à l'API/)).toBeInTheDocument();
    expect(screen.getByLabelText("Clé API OpenAI")).toHaveAccessibleDescription(/commence par « sk- »/);
    expect(screen.queryByText(/Admin Console › Privacy/)).not.toBeInTheDocument();
  });

  it("devrait mener à Google AI Studio pour une clé Gemini", () => {
    render(<ProviderConnect provider="gemini" connection={null} onActivated={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Google AI Studio/ })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
    expect(screen.getByLabelText("Clé API Gemini")).toHaveAccessibleDescription(/commence par « AIza »/);
  });
});
