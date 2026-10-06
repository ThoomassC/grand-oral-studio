import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREFERENCES_STORAGE_KEY, serializePreferences } from "@/components/preferences/preferences";
import { SiteSettingsButton } from "@/components/preferences/SiteSettingsButton";
import { resetPreferencesStoreForTests } from "@/components/preferences/store";
import { THEME_STORAGE_KEY, type ThemePreference } from "@/components/theme/theme";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

/** Node ≥ 22 expose son propre localStorage, incomplet : stockage en mémoire. */
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

const html = () => document.documentElement;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })),
  );
  for (const attr of ["data-theme", "data-text-size", "data-motion"]) html().removeAttribute(attr);
  document.cookie = "theme=; path=/; max-age=0";
  resetPreferencesStoreForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHeader(defaultTheme: ThemePreference = "system") {
  return render(
    <ThemeProvider defaultTheme={defaultTheme}>
      <ThemeToggle />
      <SiteSettingsButton />
    </ThemeProvider>,
  );
}

const trigger = () => screen.getByRole("button", { name: "Réglages" });
const panel = () => screen.getByRole("dialog", { name: "Réglages" });
const stored = () => window.localStorage.getItem(PREFERENCES_STORAGE_KEY);

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return panel();
}

describe("bouton Réglages de l'en-tête", () => {
  it("devrait annoncer un dialogue, fermé au départ", () => {
    renderHeader();
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("devrait ouvrir le panneau titré, segmenté en blocs titrés", async () => {
    const user = userEvent.setup();
    renderHeader();
    const button = trigger();
    const dialog = await openPanel(user);
    // Le reste de la page est rendu inerte par la modale : on garde la référence du bouton.
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Affichage",
      "Lisibilité",
      "Mouvements",
    ]);
    expect(within(dialog).getByRole("group", { name: "Thème" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Taille du texte" })).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "Réduire les animations" })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Rétablir les réglages par défaut" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Enregistrer/ })).not.toBeInTheDocument();
  });

  it("devrait se fermer sur Échap et rendre le focus au bouton", async () => {
    const user = userEvent.setup();
    renderHeader();
    await openPanel(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("devrait se fermer par la croix et rendre le focus au bouton", async () => {
    const user = userEvent.setup();
    renderHeader();
    const dialog = await openPanel(user);
    await user.click(within(dialog).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
});

describe("réglages du panneau", () => {
  it("devrait changer le thème tout de suite, en accord avec le bouton soleil/lune", async () => {
    const user = userEvent.setup();
    renderHeader();
    let dialog = await openPanel(user);
    const theme = () => within(panel()).getByRole("group", { name: "Thème" });
    expect(within(theme()).getByRole("button", { name: "Système" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(theme()).getByRole("button", { name: "Sombre" }));
    expect(html()).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Thème : Sombre. Enregistré.");
    await waitFor(() => expect(document.cookie).toContain("theme=dark"));

    await user.keyboard("{Escape}");
    const toggle = screen.getByRole("button", { name: "Mode sombre" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(html()).toHaveAttribute("data-theme", "light");

    dialog = await openPanel(user);
    expect(within(theme()).getByRole("button", { name: "Clair" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(theme()).getByRole("button", { name: "Système" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    await waitFor(() => expect(document.cookie).not.toContain("theme="));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Thème : Système. Enregistré.");
  });

  it("devrait agrandir le texte (attribut sur <html>, mémorisé) et proposer un aperçu", async () => {
    const user = userEvent.setup();
    renderHeader();
    const dialog = await openPanel(user);
    const size = within(dialog).getByRole("group", { name: "Taille du texte" });
    expect(within(size).getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("figure", { name: "Aperçu" })).toHaveTextContent(/organisations/);

    await user.click(within(size).getByRole("button", { name: "Très grand" }));
    expect(html()).toHaveAttribute("data-text-size", "xlarge");
    expect(within(size).getByRole("button", { name: "Très grand" })).toHaveAttribute("aria-pressed", "true");
    expect(stored()).toBe(serializePreferences({ textSize: "xlarge", motion: "system" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Taille du texte : Très grand. Enregistré.");

    await user.click(within(size).getByRole("button", { name: "Grand" }));
    expect(html()).toHaveAttribute("data-text-size", "large");
  });

  it("devrait réduire les animations (interrupteur), puis revenir au réglage de l'appareil", async () => {
    const user = userEvent.setup();
    renderHeader();
    const dialog = await openPanel(user);
    const toggle = within(dialog).getByRole("switch", { name: "Réduire les animations" });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(html()).toHaveAttribute("data-motion", "reduced");
    expect(stored()).toBe(serializePreferences({ textSize: "standard", motion: "reduced" }));
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(html()).toHaveAttribute("data-motion", "system");
  });

  it("devrait partir des réglages mémorisés", async () => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, serializePreferences({ textSize: "large", motion: "reduced" }));
    const user = userEvent.setup();
    renderHeader();
    const dialog = await openPanel(user);
    expect(within(dialog).getByRole("button", { name: "Grand" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("switch", { name: "Réduire les animations" })).toBeChecked();
  });

  it("devrait tout rétablir : thème Système, texte standard, animations de l'appareil", async () => {
    const user = userEvent.setup();
    renderHeader("dark");
    const dialog = await openPanel(user);
    await user.click(within(dialog).getByRole("button", { name: "Très grand" }));
    await user.click(within(dialog).getByRole("switch", { name: "Réduire les animations" }));

    const reset = within(dialog).getByRole("button", { name: "Rétablir les réglages par défaut" });
    await user.click(reset);
    expect(within(dialog).getByRole("button", { name: "Système" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("switch", { name: "Réduire les animations" })).not.toBeChecked();
    expect(html()).toHaveAttribute("data-text-size", "standard");
    expect(html()).toHaveAttribute("data-motion", "system");
    expect(html()).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(stored()).toBe(serializePreferences({ textSize: "standard", motion: "system" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Réglages par défaut rétablis");
    expect(reset).toHaveFocus();
  });

  it("devrait décrire le dialogue par sa phrase d'introduction", async () => {
    const user = userEvent.setup();
    renderHeader();
    const dialog = await openPanel(user);
    expect(dialog).toHaveAccessibleDescription("Propres à cet appareil, appliqués tout de suite.");
  });

  it("devrait annoncer l'état des animations, et signaler que l'appareil les réduit déjà", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    const user = userEvent.setup();
    renderHeader();
    const dialog = await openPanel(user);
    expect(within(dialog).getByText(/Votre appareil réduit déjà les animations/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("switch", { name: "Réduire les animations" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Animations réduites. Enregistré.");
    await user.click(within(dialog).getByRole("switch", { name: "Réduire les animations" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Animations selon votre appareil. Enregistré.");
  });

  it("devrait prévenir quand le réglage ne peut pas être mémorisé", async () => {
    const full = memoryStorage();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", full);
    const user = userEvent.setup();
    renderHeader();
    const dialog = await openPanel(user);
    await user.click(within(dialog).getByRole("button", { name: "Grand" }));
    expect(html()).toHaveAttribute("data-text-size", "large");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Taille du texte : Grand, pour cette visite seulement");
  });
});
