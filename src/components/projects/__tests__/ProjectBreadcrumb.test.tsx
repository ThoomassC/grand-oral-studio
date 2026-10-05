import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/projets/p1/trame";
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push, replace }) }));

const { ProjectBreadcrumb } = await import("@/components/projects/ProjectBreadcrumb");
const { UnsavedChangesBanner, UnsavedChangesProvider, useUnsavedChanges } = await import("@/components/layout/UnsavedChanges");

afterEach(async () => {
  cleanup();
  // Le démontage retire la sentinelle d'historique de la garde (`history.back()`, asynchrone).
  await new Promise((resolve) => setTimeout(resolve, 20));
  push.mockReset();
  replace.mockReset();
  pathname = "/projets/p1/trame";
});

function crumbs() {
  return screen.getByRole("navigation", { name: "Fil d'Ariane" });
}

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

function hrefs() {
  return Array.from(crumbs().querySelectorAll("a")).map((a) => a.getAttribute("href"));
}

describe("ProjectBreadcrumb", () => {
  it("devrait mener aux pages par le routeur de l'application, sans recharger", async () => {
    pathname = "/projets/p1/trame/sujets";
    const user = userEvent.setup();
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    await user.click(screen.getByRole("link", { name: "Étape 2 · Trame" }));
    expect(push).toHaveBeenCalledWith("/projets/p1/trame");
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
    expect(screen.getByRole("dialog", { name: "Quitter sans enregistrer ?" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    // La destination remplace la sentinelle d'historique de la garde : pas d'entrée en double.
    expect(replace).toHaveBeenCalledWith("/projets");
    expect(push).not.toHaveBeenCalled();
  });

  it("devrait lier le projet à son apparence, sans passer par la redirection", () => {
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    expect(screen.getByRole("link", { name: "Master" })).toHaveAttribute("href", "/projets/p1/apparence");
  });

  it("ne devrait lier aucune entrée à la page courante (Apparence)", () => {
    pathname = "/projets/p1/apparence";
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    expect(hrefs()).toEqual(["/projets"]);
    expect(screen.getByText("Étape 1 · Apparence")).toHaveAttribute("aria-current", "page");
  });

  it("devrait dire « Étape 2 · Trame » sur la trame, sans lien vers elle-même", () => {
    pathname = "/projets/p1/trame";
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    expect(hrefs()).toEqual(["/projets", "/projets/p1/apparence"]);
    expect(screen.getByText("Étape 2 · Trame")).toHaveAttribute("aria-current", "page");
  });

  it("devrait finir par « Étape 2 · Trame / Sujets » sur les sujets, la trame liée", () => {
    pathname = "/projets/p1/trame/sujets";
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    expect(screen.getByRole("link", { name: "Étape 2 · Trame" })).toHaveAttribute("href", "/projets/p1/trame");
    expect(screen.getByText("Sujets")).toHaveAttribute("aria-current", "page");
    expect(hrefs()).not.toContain("/projets/p1/trame/sujets");
  });

  it("devrait dire « Étape 3 · Jour J » sur le jour J", () => {
    pathname = "/projets/p1/jour-j";
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    expect(screen.getByText("Étape 3 · Jour J")).toHaveAttribute("aria-current", "page");
  });

  it("devrait finir par « Decks / {titre} » pour tout deck ouvert, ancien squelette compris", () => {
    pathname = "/projets/p1/decks/d1";
    render(<ProjectBreadcrumb programId="p1" programName="Master" deck={{ title: "Le climat" }} />);
    expect(screen.getByRole("link", { name: "Decks" })).toHaveAttribute("href", "/projets/p1/decks");
    expect(screen.getByText("Le climat")).toHaveAttribute("aria-current", "page");
  });

  it("devrait finir par « Decks » sur la liste des decks", () => {
    pathname = "/projets/p1/decks";
    render(<ProjectBreadcrumb programId="p1" programName="Master" />);
    expect(screen.getByText("Decks")).toHaveAttribute("aria-current", "page");
  });
});
