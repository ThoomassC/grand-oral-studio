import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/projets/p1/charte";
const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));

const { ProjectBreadcrumb } = await import("@/components/projects/ProjectBreadcrumb");
const { UnsavedChangesBanner, UnsavedChangesProvider, useUnsavedChanges } = await import("@/components/layout/UnsavedChanges");

afterEach(() => {
  cleanup();
  push.mockReset();
  pathname = "/projets/p1/charte";
});

function crumbs() {
  return screen.getByRole("navigation", { name: "Fil d'Ariane" });
}

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

describe("ProjectBreadcrumb", () => {
  it("devrait mener aux pages par le routeur de l'application, sans recharger", async () => {
    const user = userEvent.setup();
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    await user.click(screen.getByRole("link", { name: "Étape 1 · Préparer" }));
    expect(push).toHaveBeenCalledWith("/projets/p1");
  });

  it("devrait demander confirmation si l'éditeur ouvert a des modifications", async () => {
    const user = userEvent.setup();
    render(
      <UnsavedChangesProvider>
        <Dirty />
        <ProjectBreadcrumb programId="p1" programName="Master" />
        <UnsavedChangesBanner />
      </UnsavedChangesProvider>,
    );
    await user.click(screen.getByRole("link", { name: "Projets" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(push).toHaveBeenCalledWith("/projets");
  });

  it("ne devrait lier aucune entrée à la page courante (Thèmes)", () => {
    pathname = "/projets/p1";
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    const hrefs = Array.from(crumbs().querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/projets"]);
    expect(crumbs()).toHaveTextContent("Étape 1 · Préparer");
    expect(screen.getByText("Thèmes")).toHaveAttribute("aria-current", "page");
  });

  it("devrait finir par le titre du deck ouvert", () => {
    pathname = "/projets/p1/squelettes/d1";
    render(<ProjectBreadcrumb programId="p1" programName="Master" deck={{ kind: "skeleton", title: "Le climat" }} />);
    expect(screen.getByRole("link", { name: "Étape 2 · Squelettes" })).toHaveAttribute("href", "/projets/p1/squelettes");
    expect(screen.getByText("Le climat")).toHaveAttribute("aria-current", "page");
  });
});
