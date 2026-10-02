import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/themes", () => ({
  addTheme: vi.fn(),
  deleteTheme: vi.fn(),
  reorderThemes: vi.fn(),
  updateTheme: vi.fn(),
  importThemes: vi.fn(),
}));

const { ThemeManager } = await import("@/components/themes/ThemeManager");

afterEach(cleanup);

describe("Démarrage rapide par import (page Thèmes)", () => {
  it("devrait présenter les trois imports et rappeler que seuls les thèmes sont obligatoires", () => {
    render(<ThemeManager programId="p1" themes={[]} />);
    const box = screen.getByRole("region", { name: /Démarrer par import/ });
    expect(within(box).getByRole("button", { name: "Importer une liste de thèmes" })).toBeInTheDocument();
    expect(within(box).getByRole("link", { name: /charte d'une présentation/ })).toHaveAttribute(
      "href",
      "/projets/p1/charte#import-presentation",
    );
    expect(within(box).getByRole("link", { name: /gabarit avec un prompt/ })).toHaveAttribute(
      "href",
      "/projets/p1/gabarit#import-prompt",
    );
    expect(within(box).getByText(/Seuls les thèmes sont obligatoires/)).toBeInTheDocument();
  });

  it("ne devrait pas masquer le formulaire manuel", () => {
    render(<ThemeManager programId="p1" themes={[]} />);
    expect(screen.getByRole("heading", { name: "Nouveau thème" })).toBeInTheDocument();
  });

  it("devrait ouvrir l'import de liste existant", async () => {
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    const trigger = screen.getByRole("button", { name: "Importer une liste de thèmes" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "Importer des thèmes" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
