import { cleanup, render, screen } from "@testing-library/react";
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

describe("Gestionnaire de thèmes (sous le bloc d'import)", () => {
  it("ne devrait plus renvoyer vers la charte ni vers le gabarit", () => {
    render(<ThemeManager programId="p1" themes={[]} />);
    expect(screen.queryByRole("link", { name: /charte d'une présentation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gabarit avec un prompt/ })).not.toBeInTheDocument();
  });

  it("devrait garder la saisie manuelle à un clic, en secondaire", async () => {
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    expect(screen.getByText(/Importez votre sujet ci-dessus/)).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Ajouter un thème" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    await user.click(add);
    expect(screen.getByRole("heading", { name: "Nouveau thème" })).toBeInTheDocument();
  });

  it("devrait garder l'import de liste existant", async () => {
    const user = userEvent.setup();
    render(<ThemeManager programId="p1" themes={[]} />);
    const trigger = screen.getByRole("button", { name: "Importer une liste" });
    await user.click(trigger);
    expect(screen.getByRole("heading", { name: "Importer des thèmes" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
