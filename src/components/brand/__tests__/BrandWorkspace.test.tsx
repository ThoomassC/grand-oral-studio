import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/charte", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/programs", () => ({ updateBrand: vi.fn() }));

const { BrandWorkspace } = await import("@/components/brand/BrandWorkspace");

afterEach(cleanup);

describe("Page Charte", () => {
  it("ne devrait plus porter de zone d'import, mais renvoyer à l'onglet Thèmes", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.queryByRole("region", { name: "Importer depuis une présentation" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Déposez votre présentation/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /depuis l'onglet Thèmes/ })).toHaveAttribute(
      "href",
      "/projets/p1#importer-votre-sujet",
    );
  });

  it("devrait garder la charte entièrement modifiable", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.getByRole("heading", { name: "Charte graphique" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#1E3A5F");
    expect(screen.getByLabelText("Titres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeInTheDocument();
  });
});
