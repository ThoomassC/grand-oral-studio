import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSetupStatus } from "@/components/settings/ai-status";
import type { ActionResult } from "@/server/actions/result";

const activateClaude = vi.fn();
const deleteAnthropicApiKey = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/settings", () => ({
  activateClaude: (...args: unknown[]) => activateClaude(...args),
  deleteAnthropicApiKey: (...args: unknown[]) => deleteAnthropicApiKey(...args),
  setAiEngine: vi.fn(),
  testAnthropicApiKey: vi.fn(),
}));

const { ClaudeConnect } = await import("@/components/settings/ClaudeConnect");

type Claude = AiSetupStatus["claude"];
const NO_KEY: Claude = { available: false, source: "none", userKey: null };
const USER_KEY: Claude = { available: true, source: "user", userKey: { last4: "4f2a", addedAtLabel: "5 oct. 2026, 10:00" } };
const VALID_KEY = `sk-ant-api03-${"a".repeat(40)}AAAA`;

/** Le résumé de la clé, dont les 4 derniers caractères sont dans leur propre élément. */
const keySummary = (text: string) =>
  screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);

afterEach(() => {
  cleanup();
  for (const fn of [activateClaude, deleteAnthropicApiKey, refresh]) fn.mockReset();
});

const field = () => screen.getByLabelText("Clé API Anthropic");
const submit = () => screen.getByRole("button", { name: "Vérifier et activer" });

describe("ClaudeConnect — sans clé", () => {
  it("devrait proposer le lien vers la console, le champ et « Vérifier et activer », sans liste numérotée", () => {
    render(<ClaudeConnect claude={NO_KEY} onActivated={vi.fn()} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /console Anthropic, rubrique API Keys/ });
    expect(link).toHaveAttribute("href", "https://console.anthropic.com/settings/keys");
    expect(link).toHaveAttribute("target", "_blank");
    expect(field()).toHaveAttribute("autocomplete", "off");
    // Le format reste dit au lecteur d'écran, en description du champ.
    expect(field()).toHaveAccessibleDescription(/commence par « sk-ant- »/);
    expect(submit()).toBeInTheDocument();
    // Les aides détaillées sont derrière le bouton « i », pas affichées en permanence.
    expect(screen.queryByText(/Chiffrée, jamais réaffichée/)).not.toBeInTheDocument();
  });

  it("devrait détailler format, crédits et sécurité de la clé derrière le bouton « i »", async () => {
    const user = userEvent.setup();
    render(<ClaudeConnect claude={NO_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "En savoir plus : Votre clé API" }));
    const panel = await screen.findByRole("dialog", { name: "Votre clé API" });
    expect(within(panel).getByText((_, el) => el?.tagName === "DD" && /commence par « sk-ant- »/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(within(panel).getByText(/rubrique Billing/)).toBeInTheDocument();
    expect(within(panel).getByText(/chiffrée et n'est jamais réaffichée/)).toBeInTheDocument();
  });

  it("devrait refuser un format invalide sans appeler le serveur, et placer le focus sur le champ", async () => {
    const user = userEvent.setup();
    render(<ClaudeConnect claude={NO_KEY} onActivated={vi.fn()} />);
    await user.type(field(), "sk-ant-court");
    await user.click(submit());
    expect(await screen.findByText("La clé saisie n'a pas le bon format.")).toBeInTheDocument();
    expect(screen.getByText("Cette clé est trop courte : copiez-la en entier.")).toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription(/trop courte/);
    await vi.waitFor(() => expect(field()).toHaveFocus());
    expect(activateClaude).not.toHaveBeenCalled();
  });

  it("devrait refuser un champ vide sans appeler le serveur", async () => {
    const user = userEvent.setup();
    render(<ClaudeConnect claude={NO_KEY} onActivated={vi.fn()} />);
    await user.click(submit());
    expect(await screen.findByText("Saisissez votre clé API Anthropic.")).toBeInTheDocument();
    expect(activateClaude).not.toHaveBeenCalled();
  });

  it("devrait désactiver « Vérifier et activer » pendant l'envoi et ignorer un second clic", async () => {
    let resolve: (value: ActionResult<{ last4: string }>) => void = () => undefined;
    activateClaude.mockImplementation(() => new Promise((r) => (resolve = r)));
    const onActivated = vi.fn();
    const user = userEvent.setup();
    render(<ClaudeConnect claude={NO_KEY} onActivated={onActivated} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    const busy = screen.getByRole("button", { name: /Vérification de la clé/ });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    await user.click(busy);
    expect(activateClaude).toHaveBeenCalledTimes(1);
    expect(activateClaude).toHaveBeenCalledWith({ apiKey: VALID_KEY });

    await act(async () => resolve({ ok: true, data: { last4: "AAAA" } }));
    expect(await screen.findByText("Claude est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
    expect(onActivated).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
    expect(field()).toHaveValue("");
  });

  it("devrait placer le focus sur « Remplacer » quand la clé activée apparaît (après rafraîchissement)", async () => {
    activateClaude.mockResolvedValue({ ok: true, data: { last4: "AAAA" } });
    const user = userEvent.setup();
    const { rerender } = render(<ClaudeConnect claude={NO_KEY} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByText("Claude est activé : clé •••• AAAA vérifiée et enregistrée.")).toBeInTheDocument();
    // router.refresh() : la page renvoie la clé enregistrée, le formulaire (et son bouton focalisé) disparaît.
    rerender(
      <ClaudeConnect
        claude={{ available: true, source: "user", userKey: { last4: "AAAA", addedAtLabel: "" } }}
        onActivated={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Clé API Anthropic")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remplacer" })).toHaveFocus();
  });

  it("ne devrait pas voler le focus quand la clé apparaît sans activation dans cette page", () => {
    const { rerender } = render(<ClaudeConnect claude={NO_KEY} onActivated={vi.fn()} />);
    rerender(<ClaudeConnect claude={USER_KEY} onActivated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remplacer" })).not.toHaveFocus();
  });

  it("devrait afficher le refus d'Anthropic sur le champ, sans activer", async () => {
    const message = "Cette clé est refusée par Anthropic. Vérifiez-la ou créez-en une nouvelle sur console.anthropic.com.";
    activateClaude.mockResolvedValue({ ok: false, error: message, fieldErrors: { apiKey: [message] } });
    const onActivated = vi.fn();
    const user = userEvent.setup();
    render(<ClaudeConnect claude={NO_KEY} onActivated={onActivated} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cette clé est refusée par Anthropic");
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(onActivated).not.toHaveBeenCalled();
  });

  it("devrait signaler une connexion interrompue", async () => {
    activateClaude.mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();
    render(<ClaudeConnect claude={NO_KEY} onActivated={vi.fn()} />);
    await user.type(field(), VALID_KEY);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("La connexion a été interrompue. Réessayez.");
  });

  it("devrait expliquer la démonstration et la clé fournie par le serveur, en gardant la possibilité d'ajouter la sienne", () => {
    const { rerender } = render(<ClaudeConnect claude={{ available: true, source: "mock", userKey: null }} onActivated={vi.fn()} />);
    expect(screen.getByText("Mode démonstration : aucune clé nécessaire.")).toBeInTheDocument();
    expect(field()).toBeInTheDocument();
    rerender(<ClaudeConnect claude={{ available: true, source: "server", userKey: null }} onActivated={vi.fn()} />);
    expect(screen.getByText("Le serveur fournit une clé : vous pouvez aussi utiliser la vôtre.")).toBeInTheDocument();
  });
});

describe("ClaudeConnect — clé présente", () => {
  it("devrait résumer la clé sans le champ, puis le révéler avec « Remplacer »", async () => {
    const user = userEvent.setup();
    render(<ClaudeConnect claude={USER_KEY} onActivated={vi.fn()} />);
    expect(keySummary("Clé •••• 4f2a · ajoutée le 5 oct. 2026, 10:00")).toBeInTheDocument();
    expect(screen.queryByLabelText("Clé API Anthropic")).not.toBeInTheDocument();
    const replace = screen.getByRole("button", { name: "Remplacer" });
    expect(replace).toHaveAttribute("aria-expanded", "false");
    await user.click(replace);
    expect(replace).toHaveAttribute("aria-expanded", "true");
    expect(field()).toBeInTheDocument();
    await vi.waitFor(() => expect(field()).toHaveFocus());
  });

  it("devrait placer le focus sur « Remplacer » quand le formulaire de remplacement disparaît après activation", async () => {
    activateClaude.mockResolvedValue({ ok: true, data: { last4: "AAAA" } });
    const getRects = vi
      .spyOn(Element.prototype, "getClientRects")
      .mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    try {
      const user = userEvent.setup();
      render(<ClaudeConnect claude={USER_KEY} onActivated={vi.fn()} />);
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
    deleteAnthropicApiKey.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    render(<ClaudeConnect claude={USER_KEY} onActivated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Supprimer ma clé" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer votre clé ?" });
    expect(dialog).toHaveTextContent("Le jour J, la rédaction se fera sans IA tant qu'aucune clé n'est connectée.");
    await user.click(screen.getByRole("button", { name: "Supprimer la clé" }));
    await vi.waitFor(() => expect(deleteAnthropicApiKey).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Votre clé a été supprimée.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});
