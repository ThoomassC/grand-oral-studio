import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/programmes";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { SettingsLink } = await import("@/components/layout/SettingsLink");

afterEach(cleanup);

describe("SettingsLink", () => {
  it("devrait signaler la page courante sur /parametres", () => {
    pathname = "/parametres";
    render(<SettingsLink />);
    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute("aria-current", "page");
  });

  it("ne devrait rien signaler ailleurs", () => {
    pathname = "/programmes";
    render(<SettingsLink />);
    expect(screen.getByRole("link", { name: "Paramètres" })).not.toHaveAttribute("aria-current");
  });
});
