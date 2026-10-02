import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/projets";
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push, replace }) }));

const { MainNav } = await import("@/components/layout/MainNav");
const { GuardedLink } = await import("@/components/layout/GuardedLink");
const { UnsavedChangesBanner, UnsavedChangesProvider, useUnsavedChanges } = await import("@/components/layout/UnsavedChanges");

afterEach(async () => {
  cleanup();
  // Le démontage retire la sentinelle d'historique de la garde (`history.back()`, asynchrone).
  await new Promise((resolve) => setTimeout(resolve, 20));
  push.mockReset();
  replace.mockReset();
  pathname = "/projets";
});

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

/** L'en-tête (onglets et logo) sur une page dont l'éditeur a des modifications non enregistrées. */
function renderDirtyHeader() {
  pathname = "/projets/p1/charte";
  return render(
    <UnsavedChangesProvider>
      <Dirty />
      <GuardedLink href="/projets">Grand Oral Studio</GuardedLink>
      <MainNav />
      <UnsavedChangesBanner />
    </UnsavedChangesProvider>,
  );
}

const modal = () => screen.queryByRole("dialog", { name: "Quitter sans enregistrer ?" });

describe("MainNav", () => {
  it("devrait proposer Projets puis Paramètres dans la navigation principale", () => {
    render(<MainNav />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual(["Projets", "Paramètres"]);
    expect(screen.getByRole("link", { name: "Projets" })).toHaveAttribute("href", "/projets");
    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute("href", "/parametres");
  });

  it("devrait signaler la page courante sur /parametres", () => {
    pathname = "/parametres";
    render(<MainNav />);
    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Projets" })).not.toHaveAttribute("aria-current");
  });

  it("devrait signaler Projets sur la liste et dans chaque projet", () => {
    for (const path of ["/projets", "/projets/abc/jour-j"]) {
      pathname = path;
      render(<MainNav />);
      expect(screen.getByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Paramètres" })).not.toHaveAttribute("aria-current");
      cleanup();
    }
  });

  it("devrait garder aria-current sous la garde", () => {
    renderDirtyHeader();
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
  });

  it("devrait demander confirmation avant de quitter par un onglet, puis rendre le focus en restant", async () => {
    const user = userEvent.setup();
    renderDirtyHeader();
    const tab = within(screen.getByRole("navigation", { name: "Navigation principale" })).getByRole("link", { name: "Paramètres" });
    await user.click(tab);
    expect(modal()).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Rester sur la page" }));
    await waitFor(() => expect(tab).toHaveFocus());

    await user.click(tab);
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(replace).toHaveBeenCalledWith("/parametres");
  });

  it("devrait demander confirmation avant de quitter par le logo", async () => {
    const user = userEvent.setup();
    renderDirtyHeader();
    await user.click(screen.getByRole("link", { name: "Grand Oral Studio" }));
    expect(modal()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(replace).toHaveBeenCalledWith("/projets");
  });
});
