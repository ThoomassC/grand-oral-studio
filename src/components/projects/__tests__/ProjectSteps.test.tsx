import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePrepare, makeSteps } from "./fixtures";

let pathname = "/projets/p1/charte";
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push, replace }) }));

const { ProjectSteps } = await import("@/components/layout/ProjectSteps");
const { UnsavedChangesBanner, UnsavedChangesProvider, useUnsavedChanges } = await import("@/components/layout/UnsavedChanges");
const { StepNav } = await import("@/components/projects/StepNav");

afterEach(async () => {
  cleanup();
  // Le démontage retire la sentinelle d'historique de la garde (`history.back()`, asynchrone).
  await new Promise((resolve) => setTimeout(resolve, 20));
  push.mockReset();
  replace.mockReset();
  pathname = "/projets/p1/charte";
});

const STEPS = makeSteps(["prepare"], { day: "skeletons" });

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

/** Le fil d'étapes dans un projet dont l'éditeur ouvert a des modifications non enregistrées. */
function renderDirty(extra?: ReactNode) {
  return render(
    <UnsavedChangesProvider>
      <Dirty />
      <ProjectSteps programId="p1" steps={STEPS} deckCount={0} />
      <UnsavedChangesBanner />
      {extra}
    </UnsavedChangesProvider>,
  );
}

function nav() {
  return screen.getByRole("navigation", { name: "Étapes du projet" });
}

describe("ProjectSteps", () => {
  it("devrait lister les 3 étapes dans l'ordre, avec leurs liens", () => {
    render(<ProjectSteps programId="p1" steps={STEPS} deckCount={2} />);
    expect(within(nav()).getAllByRole("listitem")).toHaveLength(3);
    expect(within(nav()).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/projets/p1",
      "/projets/p1/squelettes",
      "/projets/p1/jour-j",
    ]);
  });

  it("devrait marquer Préparer courante sur la charte, et dire l'état de chaque étape en texte", () => {
    render(<ProjectSteps programId="p1" steps={STEPS} deckCount={2} />);
    expect(within(nav()).getByRole("link", { current: "step" })).toHaveAttribute("href", "/projets/p1");
    expect(within(nav()).getByRole("link", { name: /Étape 1.*Préparer.*faite/ })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /Étape 2.*Squelettes.*à faire/ })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /Étape 3.*Jour J.*bloquée : Générez d'abord les squelettes/ })).toBeInTheDocument();
  });

  it("devrait garder Squelettes courante sur un squelette ouvert", () => {
    pathname = "/projets/p1/squelettes/d9";
    render(<ProjectSteps programId="p1" steps={STEPS} deckCount={0} />);
    expect(within(nav()).getByRole("link", { current: "step" })).toHaveAttribute("href", "/projets/p1/squelettes");
  });

  it("devrait proposer les Decks à part, avec leur nombre", () => {
    render(<ProjectSteps programId="p1" steps={STEPS} deckCount={2} />);
    expect(screen.getByRole("link", { name: /Decks.*2 diaporamas/ })).toHaveAttribute("href", "/projets/p1/decks");
    expect(within(nav()).queryByRole("link", { name: /Decks/ })).not.toBeInTheDocument();
  });

  it("devrait demander confirmation avant de quitter une page aux modifications non enregistrées", async () => {
    const user = userEvent.setup();
    renderDirty();
    await user.click(within(nav()).getByRole("link", { name: /Squelettes/ }));
    expect(screen.getByRole("dialog", { name: "Quitter sans enregistrer ?" })).toHaveTextContent("Vos modifications ne sont pas enregistrées");
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    // La destination remplace la sentinelle d'historique de la garde : pas d'entrée en double.
    expect(replace).toHaveBeenCalledWith("/projets/p1/squelettes");
    expect(push).not.toHaveBeenCalled();
  });

  it("devrait garder « Préparer » depuis la charte : l'étape est courante, mais c'est une autre page", async () => {
    const user = userEvent.setup();
    renderDirty();
    await user.click(within(nav()).getByRole("link", { name: /Préparer/ }));
    expect(screen.getByRole("dialog", { name: "Quitter sans enregistrer ?" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("devrait rendre le focus au lien cliqué quand on reste sur la page (bouton ou Échap)", async () => {
    const user = userEvent.setup();
    renderDirty();
    const link = within(nav()).getByRole("link", { name: /Squelettes/ });
    await user.click(link);
    const stay = screen.getByRole("button", { name: "Rester sur la page" });
    await waitFor(() => expect(stay).toHaveFocus());
    await user.click(stay);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(link).toHaveFocus();

    await user.click(link);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rester sur la page" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(link).toHaveFocus();
  });

  it("ne devrait afficher qu'une confirmation, quel que soit le lien cliqué", async () => {
    pathname = "/projets/p1/gabarit";
    const user = userEvent.setup();
    renderDirty(<StepNav programId="p1" prepare={makePrepare({ themes: true })} steps={STEPS} />);
    await user.click(within(nav()).getByRole("link", { name: /Jour J/ }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // La modale rend le reste de la page inerte : on reste, puis on suit un autre lien.
    await user.click(screen.getByRole("button", { name: "Rester sur la page" }));
    await user.click(screen.getByRole("link", { name: /Étape suivante/ }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    // La destination remplace la sentinelle d'historique de la garde : pas d'entrée en double.
    expect(replace).toHaveBeenCalledWith("/projets/p1/squelettes");
    expect(push).not.toHaveBeenCalled();
  });

  it("devrait dire une étape bloquée sans infobulle, et séparer libellé et résumé", () => {
    render(<ProjectSteps programId="p1" steps={STEPS} deckCount={0} />);
    const day = within(nav()).getByRole("link", { name: /Jour J/ });
    expect(day).not.toHaveAttribute("title");
    expect(day.querySelector(".project-step__dot .opale-icon")).not.toBeNull();
    expect(within(nav()).getByRole("link", { name: /^Étape 1 :\s?Préparer,\s?résumé prepare\s?— faite$/ })).toBeInTheDocument();
  });

  it("devrait placer les Decks dans une navigation nommée", () => {
    render(<ProjectSteps programId="p1" steps={STEPS} deckCount={1} />);
    const decks = screen.getByRole("navigation", { name: "Diaporamas du projet" });
    expect(within(decks).getByRole("link", { name: /Decks.*1 diaporama$/ })).toHaveAttribute("href", "/projets/p1/decks");
  });
});
