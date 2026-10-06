import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/apparence", useRouter: () => ({ push: vi.fn() }) }));
const updateBrand = vi.fn();
vi.mock("@/server/actions/programs", () => ({ updateBrand: (...args: unknown[]) => updateBrand(...args) }));

const { BrandWorkspace } = await import("@/components/brand/BrandWorkspace");

afterEach(cleanup);

describe("Éditeur de la page Apparence", () => {
  it("ne devrait plus renvoyer vers une autre page pour importer (thèmes, sujets)", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Thèmes/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Déposez votre présentation/)).not.toBeInTheDocument();
  });

  it("devrait garder l'apparence entièrement modifiable", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#1E3A5F");
    expect(screen.getByLabelText("Titres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeInTheDocument();
  });

  it("devrait garder « Apparence enregistrée. » quand la page se rafraîchit avec l'apparence enregistrée", async () => {
    updateBrand.mockResolvedValue({ ok: true, data: null });
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const name = screen.getByRole("textbox", { name: "Nom de l'apparence" });
    fireEvent.change(name, { target: { value: "Couleurs du master" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'apparence" }));
    await screen.findByText("Apparence enregistrée.");
    // Rafraîchissement serveur après l'enregistrement : même apparence, nouvelle date d'enregistrement.
    rerender(<BrandWorkspace programId="p1" initialBrand={{ ...initial, name: "Couleurs du master" }} format="16:9" />);
    expect(screen.getByText("Apparence enregistrée.")).toBeInTheDocument();
  });

  it("devrait reprendre l'apparence importée quand elle change côté serveur", async () => {
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const imported = { ...initial, name: "Apparence importée", colors: { ...initial.colors, primary: "#AA3300" } };
    rerender(<BrandWorkspace programId="p1" initialBrand={imported} format="16:9" />);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#AA3300"),
    );
    expect(screen.getByRole("textbox", { name: "Nom de l'apparence" })).toHaveValue("Apparence importée");
  });
});
