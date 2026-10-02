import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePrepare, makeSteps } from "./fixtures";

let pathname = "/projets/p1/charte";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));

const { StepNav, StepBlockedNotice } = await import("@/components/projects/StepNav");
const { PrepareNav } = await import("@/components/projects/PrepareNav");

afterEach(cleanup);

describe("StepNav", () => {
  it("devrait enchaîner Thèmes → Charte → Gabarit → Squelettes", () => {
    pathname = "/projets/p1/charte";
    render(<StepNav programId="p1" prepare={makePrepare()} steps={makeSteps([])} />);
    expect(screen.getByRole("link", { name: /Étape précédente\s?: Thèmes/ })).toHaveAttribute("href", "/projets/p1");
    expect(screen.getByRole("link", { name: /Étape suivante : Gabarit/ })).toHaveAttribute("href", "/projets/p1/gabarit");
  });

  it("ne devrait pas proposer d'étape précédente sur les thèmes", () => {
    pathname = "/projets/p1";
    render(<StepNav programId="p1" prepare={makePrepare()} steps={makeSteps([])} />);
    expect(screen.queryByRole("link", { name: /Étape précédente/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Étape suivante : Charte/ })).toBeInTheDocument();
  });

  it("devrait proposer de passer aux squelettes dès qu'il y a un thème", () => {
    pathname = "/projets/p1";
    const { rerender } = render(<StepNav programId="p1" prepare={makePrepare()} steps={makeSteps([])} />);
    expect(screen.queryByRole("link", { name: /Passer aux squelettes/ })).not.toBeInTheDocument();
    rerender(<StepNav programId="p1" prepare={makePrepare({ themes: true })} steps={makeSteps(["prepare"])} />);
    expect(screen.getByRole("link", { name: /Passer aux squelettes/ })).toHaveAttribute("href", "/projets/p1/squelettes");
  });

  it("devrait nommer la vraie destination de l'étape précédente des squelettes (le gabarit)", () => {
    pathname = "/projets/p1/squelettes";
    render(<StepNav programId="p1" prepare={makePrepare({ themes: true })} steps={makeSteps(["prepare", "skeletons"])} />);
    expect(screen.getByRole("link", { name: /Étape précédente\s?: Gabarit/ })).toHaveAttribute("href", "/projets/p1/gabarit");
    expect(screen.getByRole("link", { name: /^Étape suivante : Jour J$/ })).toBeInTheDocument();
  });

  it("devrait dire que l'étape suivante est bloquée, et pourquoi", () => {
    pathname = "/projets/p1/squelettes";
    render(<StepNav programId="p1" prepare={makePrepare({ themes: true })} steps={makeSteps(["prepare"], { day: "skeletons" })} />);
    expect(screen.getByRole("link", { name: /Étape suivante : Jour J.*bloquée : Générez d'abord les squelettes/ })).toHaveAttribute(
      "href",
      "/projets/p1/jour-j",
    );
  });

  it("devrait mener aux diaporamas depuis le Jour J", () => {
    pathname = "/projets/p1/jour-j";
    render(<StepNav programId="p1" prepare={makePrepare()} steps={makeSteps([])} />);
    expect(screen.getByRole("link", { name: /Voir les diaporamas/ })).toHaveAttribute("href", "/projets/p1/decks");
  });

  it("ne devrait rien afficher hors des pages d'étape", () => {
    pathname = "/projets/p1/decks";
    const { container } = render(<StepNav programId="p1" prepare={makePrepare()} steps={makeSteps([])} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PrepareNav", () => {
  it("devrait proposer Thèmes, Charte et Gabarit avec leur état, la page courante marquée", () => {
    pathname = "/projets/p1/charte";
    render(<PrepareNav programId="p1" items={makePrepare({ themes: true, template: true })} />);
    const nav = screen.getByRole("navigation", { name: /Préparer/ });
    expect(nav.querySelectorAll("a")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Thèmes.*2 thèmes/ })).toHaveAttribute("href", "/projets/p1");
    expect(screen.getByRole("link", { name: /Charte.*Par défaut/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Gabarit.*Personnalisé/ })).toHaveAttribute("href", "/projets/p1/gabarit");
  });

  it("devrait signaler les thèmes obligatoires et ne proposer de sauter qu'avec un thème", () => {
    pathname = "/projets/p1";
    const { rerender } = render(<PrepareNav programId="p1" items={makePrepare()} />);
    expect(screen.getByRole("link", { name: /Thèmes.*Obligatoire/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Passer aux squelettes/ })).not.toBeInTheDocument();
    rerender(<PrepareNav programId="p1" items={makePrepare({ themes: true })} />);
    expect(screen.getByRole("link", { name: /Passer aux squelettes/ })).toHaveAttribute("href", "/projets/p1/squelettes");
  });

  it("ne devrait rien afficher hors de Préparer", () => {
    pathname = "/projets/p1/squelettes";
    const { container } = render(<PrepareNav programId="p1" items={makePrepare()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("StepBlockedNotice", () => {
  it("devrait expliquer le prérequis manquant avec un lien vers son étape", () => {
    pathname = "/projets/p1/squelettes";
    render(<StepBlockedNotice programId="p1" steps={makeSteps([], { skeletons: "prepare" })} />);
    expect(screen.getByText(/Ajoutez d'abord des thèmes/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Étape 1 · Préparer/ })).toHaveAttribute("href", "/projets/p1");
  });

  it("ne devrait rien afficher si l'étape n'est pas bloquée", () => {
    pathname = "/projets/p1/charte";
    const { container } = render(<StepBlockedNotice programId="p1" steps={makeSteps([])} />);
    expect(container).toBeEmptyDOMElement();
  });
});
