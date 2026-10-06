import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/projets/p1/apparence";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));

const { StepNav } = await import("@/components/projects/StepNav");

afterEach(cleanup);

describe("StepNav", () => {
  it("devrait mener de l'apparence à la trame, sans étape précédente, avec le raccourci vers le Jour J", () => {
    pathname = "/projets/p1/apparence";
    render(<StepNav programId="p1" />);
    expect(screen.queryByRole("link", { name: /Étape précédente/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Étape suivante : Trame$/ })).toHaveAttribute("href", "/projets/p1/trame");
    expect(screen.getByRole("link", { name: /^Passer au Jour J$/ })).toHaveAttribute("href", "/projets/p1/jour-j");
    expect(screen.queryByRole("link", { name: /Ajouter des sujets/ })).not.toBeInTheDocument();
  });

  it("devrait mener de la trame au Jour J, les sujets (pas une étape) en lien secondaire", () => {
    pathname = "/projets/p1/trame";
    render(<StepNav programId="p1" />);
    expect(screen.getByRole("link", { name: /Étape précédente\s?: Apparence/ })).toHaveAttribute("href", "/projets/p1/apparence");
    const next = screen.getByRole("link", { name: /^Étape suivante : Jour J$/ });
    expect(next).toHaveAttribute("href", "/projets/p1/jour-j");
    expect(next).toHaveClass("opale-button--primary");
    const subjects = screen.getByRole("link", { name: /^Ajouter des sujets \(facultatif\)$/ });
    expect(subjects).toHaveAttribute("href", "/projets/p1/trame/sujets");
    expect(subjects).not.toHaveClass("opale-button--primary");
    expect(screen.queryByRole("link", { name: /Étape suivante : Sujets/ })).not.toBeInTheDocument();
    // L'étape suivante est déjà le Jour J : pas de raccourci en double.
    expect(screen.queryByRole("link", { name: /Passer au Jour J/ })).not.toBeInTheDocument();
  });

  it("devrait mener des sujets au Jour J, sans raccourci redondant", () => {
    pathname = "/projets/p1/trame/sujets";
    render(<StepNav programId="p1" />);
    expect(screen.getByRole("link", { name: /Étape précédente\s?: Trame/ })).toHaveAttribute("href", "/projets/p1/trame");
    expect(screen.getByRole("link", { name: /^Étape suivante : Jour J$/ })).toHaveAttribute("href", "/projets/p1/jour-j");
    expect(screen.queryByRole("link", { name: /Passer au Jour J/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ajouter des sujets/ })).not.toBeInTheDocument();
  });

  it("devrait mener aux diaporamas depuis le Jour J, l'étape précédente étant la trame (les sujets ne sont pas une étape)", () => {
    pathname = "/projets/p1/jour-j";
    render(<StepNav programId="p1" />);
    expect(screen.getByRole("link", { name: /Étape précédente\s?: Trame/ })).toHaveAttribute("href", "/projets/p1/trame");
    expect(screen.getByRole("link", { name: /Voir les diaporamas/ })).toHaveAttribute("href", "/projets/p1/decks");
    expect(screen.queryByRole("link", { name: /Passer au Jour J/ })).not.toBeInTheDocument();
  });

  it("ne devrait jamais dire une étape bloquée : l'étape suivante reste l'action principale", () => {
    pathname = "/projets/p1/trame/sujets";
    render(<StepNav programId="p1" />);
    const next = screen.getByRole("link", { name: /Étape suivante/ });
    expect(next).toHaveClass("opale-button--primary");
    expect(next).not.toHaveTextContent(/bloquée/);
  });

  it.each(["/projets/p1/decks", "/projets/p1/decks/d1", "/projets/p1"])("ne devrait rien afficher hors des pages d'étape (%s)", (path) => {
    pathname = path;
    const { container } = render(<StepNav programId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
