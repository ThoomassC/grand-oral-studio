import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTemplateTabs } from "./fixtures";

let pathname = "/projets/p1/trame";
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push, replace }) }));

const { TemplateTabs } = await import("@/components/projects/TemplateTabs");
const { UnsavedChangesBanner, UnsavedChangesProvider, useUnsavedChanges } = await import("@/components/layout/UnsavedChanges");

afterEach(async () => {
  cleanup();
  // Le démontage retire la sentinelle d'historique de la garde (`history.back()`, asynchrone).
  await new Promise((resolve) => setTimeout(resolve, 20));
  push.mockReset();
  replace.mockReset();
});

function nav() {
  return screen.getByRole("navigation", { name: "Trame : diapos et sujets" });
}

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

describe("TemplateTabs", () => {
  it("devrait proposer Diapos et Sujets, la page courante marquée", () => {
    pathname = "/projets/p1/trame";
    render(<TemplateTabs programId="p1" tabs={makeTemplateTabs()} />);
    const links = within(nav()).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/projets/p1/trame", "/projets/p1/trame/sujets"]);
    expect(within(nav()).getByRole("link", { name: /^Diapos/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav()).getByRole("link", { name: /^Sujets/ })).not.toHaveAttribute("aria-current");
  });

  it("devrait marquer Sujets courant sur la page des sujets", () => {
    pathname = "/projets/p1/trame/sujets";
    render(<TemplateTabs programId="p1" tabs={makeTemplateTabs()} />);
    expect(within(nav()).getByRole("link", { current: "page" })).toHaveAccessibleName(/^Sujets/);
  });

  it("devrait dire l'état de chaque onglet en texte : « Par défaut », « Facultatif »", () => {
    pathname = "/projets/p1/trame";
    render(<TemplateTabs programId="p1" tabs={makeTemplateTabs()} />);
    expect(within(nav()).getByRole("link", { name: /^Diapos\s?:\s?Par défaut$/ })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /^Sujets\s?:\s?Facultatif$/ })).toBeInTheDocument();
  });

  it("devrait dire « Personnalisée » et le nombre de sujets une fois remplis", () => {
    pathname = "/projets/p1/trame";
    const { rerender } = render(<TemplateTabs programId="p1" tabs={makeTemplateTabs({ slides: true, subjects: 3 })} />);
    expect(within(nav()).getByRole("link", { name: /^Diapos\s?:\s?Personnalisée$/ })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /^Sujets\s?:\s?3 sujets$/ })).toBeInTheDocument();
    rerender(<TemplateTabs programId="p1" tabs={makeTemplateTabs({ subjects: 1 })} />);
    expect(within(nav()).getByRole("link", { name: /^Sujets\s?:\s?1 sujet$/ })).toBeInTheDocument();
  });

  it.each(["/projets/p1/apparence", "/projets/p1/jour-j", "/projets/p1/decks", "/projets/p1/trame-x"])(
    "ne devrait rien afficher hors de la trame (%s)",
    (path) => {
      pathname = path;
      const { container } = render(<TemplateTabs programId="p1" tabs={makeTemplateTabs()} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("devrait demander confirmation avant de quitter des modifications non enregistrées", async () => {
    pathname = "/projets/p1/trame";
    const user = userEvent.setup();
    render(
      <UnsavedChangesProvider>
        <Dirty />
        <TemplateTabs programId="p1" tabs={makeTemplateTabs()} />
        <UnsavedChangesBanner />
      </UnsavedChangesProvider>,
    );
    await user.click(within(nav()).getByRole("link", { name: /^Sujets/ }));
    expect(screen.getByRole("dialog", { name: "Quitter sans enregistrer ?" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
