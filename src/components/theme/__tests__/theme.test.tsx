import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "@/components/theme/AppearanceSettings";
import { parseExplicitTheme, THEME_INIT_SCRIPT } from "@/components/theme/theme";
import { readPreference, setPreference, toggleTheme } from "@/components/theme/theme-store";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

// globals: false dans vitest.config → pas de nettoyage automatique de Testing Library.
afterEach(cleanup);

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: dark && query.includes("dark"), media: query, addEventListener() {}, removeEventListener() {} })),
  );
}

function clearCookie() {
  document.cookie = "theme=; path=/; max-age=0";
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
  clearCookie();
  mockSystemDark(false);
});

describe("parseExplicitTheme", () => {
  it("ne devrait accepter que light et dark (tout le reste = système)", () => {
    expect(parseExplicitTheme("light")).toBe("light");
    expect(parseExplicitTheme("dark")).toBe("dark");
    expect(parseExplicitTheme("system")).toBeNull();
    expect(parseExplicitTheme("<script>")).toBeNull();
    expect(parseExplicitTheme(undefined)).toBeNull();
  });
});

describe("setPreference", () => {
  it("devrait poser data-theme, localStorage et le cookie lu par le serveur", () => {
    setPreference("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.cookie).toContain("theme=dark");
    expect(readPreference()).toBe("dark");
  });

  it("« système » devrait tout retirer pour laisser prefers-color-scheme décider", () => {
    setPreference("dark");
    setPreference("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("theme")).toBeNull();
    expect(document.cookie).not.toContain("theme=dark");
    expect(readPreference()).toBe("system");
  });
});

describe("toggleTheme", () => {
  it("devrait partir du thème affiché par le système quand aucun choix n'est fait", () => {
    mockSystemDark(true);
    expect(toggleTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("devrait alterner clair et sombre", () => {
    expect(toggleTheme()).toBe("dark");
    expect(toggleTheme()).toBe("light");
  });
});

describe("script inline", () => {
  it("devrait appliquer le choix mémorisé et resynchroniser le cookie", () => {
    window.localStorage.setItem("theme", "dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.cookie).toContain("theme=dark");
  });

  it("ne devrait rien toucher sans choix mémorisé (attribut rendu par le serveur conservé)", () => {
    document.documentElement.setAttribute("data-theme", "light");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("devrait ignorer une valeur stockée inattendue", () => {
    window.localStorage.setItem("theme", "violet");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("ThemeToggle", () => {
  it("devrait garder un nom fixe et exposer le thème affiché par aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Mode sombre" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(screen.getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("devrait refléter le mode système sombre", () => {
    mockSystemDark(true);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("bouton de l'en-tête et page Paramètres", () => {
  it("devrait rester synchronisés", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemeToggle />
        <AppearanceSettings serverPreference="system" />
      </>,
    );
    expect(screen.getByRole("radio", { name: /Système/ })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Mode sombre" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: /Sombre/ })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /Système/ }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(screen.getByRole("radio", { name: /Système/ })).toBeChecked();
  });

  it("devrait suivre un changement fait dans un autre onglet", () => {
    render(<AppearanceSettings serverPreference="system" />);
    act(() => {
      window.localStorage.setItem("theme", "light");
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "light" }));
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("radio", { name: /Clair/ })).toBeChecked();
  });
});
