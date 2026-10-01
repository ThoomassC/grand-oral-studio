import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSteps } from "./fixtures";

let pathname = "/projets/p1/charte";
const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));

const { ProjectSteps } = await import("@/components/layout/ProjectSteps");
const { UnsavedChangesProvider, useUnsavedChanges } = await import("@/components/layout/UnsavedChanges");

afterEach(() => {
  cleanup();
  push.mockReset();
  pathname = "/projets/p1/charte";
});

const STEPS = makeSteps(["prepare"], { day: "skeletons" });

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
    function Dirty() {
      useUnsavedChanges(true);
      return null;
    }
    const user = userEvent.setup();
    render(
      <UnsavedChangesProvider>
        <Dirty />
        <ProjectSteps programId="p1" steps={STEPS} deckCount={0} />
      </UnsavedChangesProvider>,
    );
    await user.click(within(nav()).getByRole("link", { name: /Squelettes/ }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Vos modifications ne sont pas enregistrées");
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(push).toHaveBeenCalledWith("/projets/p1/squelettes");
  });
});
