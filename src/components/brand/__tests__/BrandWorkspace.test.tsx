import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/apparence", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/programs", () => ({ updateBrand: vi.fn() }));

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
});
