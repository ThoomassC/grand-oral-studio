import { opaleThemeScript } from "@thomascaron/opale-ui";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseExplicitTheme, THEME_STORAGE_KEY, themeCookie, type ThemePreference } from "@/components/theme/theme";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

// globals: false dans vitest.config → pas de nettoyage automatique de Testing Library.
afterEach(cleanup);

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: dark && query.includes("dark"), media: query, addEventListener() {}, removeEventListener() {} })),
  );
}

/** Node ≥ 22 expose son propre localStorage (incomplet sans --localstorage-file) : stockage en mémoire. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  document.documentElement.removeAttribute("data-theme");
  document.cookie = "theme=; path=/; max-age=0";
  mockSystemDark(false);
});

function renderTheme(defaultTheme: ThemePreference = "system") {
  return render(
    <ThemeProvider defaultTheme={defaultTheme}>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("theme.ts", () => {
  it("ne devrait accepter que light et dark dans le cookie (tout le reste = système)", () => {
    expect(parseExplicitTheme("light")).toBe("light");
    expect(parseExplicitTheme("dark")).toBe("dark");
    expect(parseExplicitTheme("system")).toBeNull();
    expect(parseExplicitTheme("<script>")).toBeNull();
    expect(parseExplicitTheme(undefined)).toBeNull();
  });

  it("devrait effacer le cookie pour « système »", () => {
    expect(themeCookie("dark")).toMatch(/^theme=dark; path=\/; max-age=\d+/);
    expect(themeCookie("system")).toMatch(/^theme=; path=\/; max-age=0/);
  });
});

describe("script d'Opale avec nos options", () => {
  it("devrait poser le choix mémorisé sous la clé « theme »", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(opaleThemeScript({ storageKey: THEME_STORAGE_KEY, defaultTheme: "system" }))();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("devrait retomber sur le choix du cookie (défaut) sans choix mémorisé", () => {
    new Function(opaleThemeScript({ storageKey: THEME_STORAGE_KEY, defaultTheme: "dark" }))();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("ThemeToggle", () => {
  it("devrait garder un nom fixe et exposer le thème affiché par aria-pressed", async () => {
    const user = userEvent.setup();
    renderTheme();
    const button = screen.getByRole("button", { name: "Mode sombre" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(screen.getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    await waitFor(() => expect(document.cookie).toContain("theme=dark"));
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("devrait refléter le mode système sombre", async () => {
    mockSystemDark(true);
    renderTheme();
    expect(screen.getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
  });

  it("devrait partir du choix lu dans le cookie par le serveur", () => {
    renderTheme("dark");
    expect(screen.getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
  });
});

// La synchronisation avec le choix Clair / Sombre / Système du panneau Réglages
// est testée avec le panneau (components/preferences/__tests__/SiteSettings.test.tsx).
