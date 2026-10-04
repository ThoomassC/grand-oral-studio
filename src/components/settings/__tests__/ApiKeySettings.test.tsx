import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyStatus } from "@/components/settings/ApiKeySettings";

const save = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/settings", () => ({
  saveAnthropicApiKey: (...args: unknown[]) => save(...args),
  deleteAnthropicApiKey: vi.fn(),
  testAnthropicApiKey: vi.fn(),
}));

const { ApiKeySettings } = await import("@/components/settings/ApiKeySettings");

const VALID_KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

const MOCK: ApiKeyStatus = { configured: false, last4: null, updatedAtLabel: null, effectiveSource: "mock", model: "mock" };

afterEach(() => {
  cleanup();
  save.mockReset();
  refresh.mockReset();
});

describe("ApiKeySettings", () => {
  it("devrait dire en clair quelle clé est utilisée", () => {
    const { rerender } = render(<ApiKeySettings status={MOCK} />);
    expect(screen.getByText(/Mode démo : contenus factices/)).toBeInTheDocument();
    rerender(
      <ApiKeySettings
        status={{ configured: true, last4: "ab12", updatedAtLabel: "1 oct. 2026, 14:03", effectiveSource: "user", model: "claude-x" }}
      />,
    );
    expect(screen.getByText(/sk-ant-…ab12/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer ma clé" })).toBeInTheDocument();
  });

  it("devrait refuser un format invalide sans appeler le serveur", async () => {
    const user = userEvent.setup();
    render(<ApiKeySettings status={MOCK} />);
    const input = screen.getByLabelText("Votre clé API Anthropic", { selector: "input" });
    await user.type(input, "abc");
    await user.click(screen.getByRole("button", { name: "Vérifier et enregistrer" }));
    expect(await screen.findByText(/Une clé API Anthropic commence par « sk-ant- »/)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(save).not.toHaveBeenCalled();
  });

  it("devrait vider le champ après un enregistrement réussi", async () => {
    save.mockResolvedValue({ ok: true, data: { last4: "6789" } });
    const user = userEvent.setup();
    render(<ApiKeySettings status={MOCK} />);
    const input = screen.getByLabelText("Votre clé API Anthropic", { selector: "input" });
    expect(input).toHaveAttribute("autocomplete", "off");
    await user.type(input, VALID_KEY);
    await user.click(screen.getByRole("button", { name: "Vérifier et enregistrer" }));
    expect(await screen.findByText(/se termine par 6789/)).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith({ apiKey: VALID_KEY });
    expect(input).toHaveValue("");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("devrait afficher le refus du serveur sur le champ", async () => {
    save.mockResolvedValue({
      ok: false,
      error: "Cette clé est refusée par Anthropic.",
      fieldErrors: { apiKey: ["Cette clé est refusée par Anthropic."] },
    });
    const user = userEvent.setup();
    render(<ApiKeySettings status={MOCK} />);
    const input = screen.getByLabelText("Votre clé API Anthropic", { selector: "input" });
    await user.type(input, VALID_KEY);
    await user.click(screen.getByRole("button", { name: "Vérifier et enregistrer" }));
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getAllByText(/refusée par Anthropic/).length).toBeGreaterThan(0);
  });
});
