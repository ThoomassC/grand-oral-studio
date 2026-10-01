import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/programmes";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { MainNav } = await import("@/components/layout/MainNav");

afterEach(cleanup);

describe("MainNav", () => {
  it("devrait proposer Projets puis Paramètres dans la navigation principale", () => {
    render(<MainNav />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual(["Projets", "Paramètres"]);
    expect(screen.getByRole("link", { name: "Projets" })).toHaveAttribute("href", "/programmes");
    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute("href", "/parametres");
  });

  it("devrait signaler la page courante sur /parametres", () => {
    pathname = "/parametres";
    render(<MainNav />);
    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Projets" })).not.toHaveAttribute("aria-current");
  });

  it("devrait signaler Projets sur la liste et dans chaque projet", () => {
    for (const path of ["/programmes", "/programmes/abc/jour-j"]) {
      pathname = path;
      render(<MainNav />);
      expect(screen.getByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Paramètres" })).not.toHaveAttribute("aria-current");
      cleanup();
    }
  });
});
