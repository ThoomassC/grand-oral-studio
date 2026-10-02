import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREFERENCES_STORAGE_KEY, serializePreferences } from "@/components/preferences/preferences";
import { resetPreferencesStoreForTests } from "@/components/preferences/store";
import { SettingsToc, TOC_SECTIONS } from "@/components/settings/SettingsToc";

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

type ObserverCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let observerCallback: ObserverCallback = () => {};
let wide = true;
let systemReducedMotion = false;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetPreferencesStoreForTests();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: ObserverCallback) {
        observerCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Écran large par défaut (rail latéral) ; `wide = false` simule un téléphone.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("min-width") ? wide : q.includes("reduced-motion") ? systemReducedMotion : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  document.body.innerHTML = "";
  for (const s of TOC_SECTIONS) {
    const section = document.createElement("section");
    section.id = `section-${s.id}`;
    const h2 = document.createElement("h2");
    h2.id = s.id;
    h2.tabIndex = -1;
    h2.textContent = s.label;
    section.append(h2);
    section.scrollIntoView = vi.fn();
    document.body.append(section);
  }
});

afterEach(() => {
  cleanup();
  wide = true;
  systemReducedMotion = false;
});

describe("SettingsToc", () => {
  it("devrait proposer un sommaire nommé avec un lien par partie", () => {
    render(<SettingsToc />);
    const nav = screen.getByRole("navigation", { name: "Sommaire de la configuration IA" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#moteur", "#cle-api"]);
    expect(screen.getByRole("link", { name: /Moteur de rédaction/ })).toHaveAttribute("aria-current", "page");
  });

  it("devrait ranger les entrées en parties nommées « Rédaction » et « Accès »", () => {
    render(<SettingsToc />);
    const redaction = screen.getByRole("group", { name: "Rédaction" });
    expect([...redaction.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#moteur"]);
    const access = screen.getByRole("group", { name: "Accès" });
    expect([...access.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#cle-api"]);
  });

  it("ne devrait plus proposer d'entrée Apparence (déplacée dans le panneau Réglages)", () => {
    render(<SettingsToc />);
    expect(screen.queryByRole("link", { name: /Apparence/ })).not.toBeInTheDocument();
  });

  it("devrait se replier et se déplier, et mémoriser l'état", async () => {
    const user = userEvent.setup();
    render(<SettingsToc />);
    const toggle = screen.getByRole("button", { name: "Replier le sommaire" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls");
    await user.click(toggle);
    const expand = screen.getByRole("button", { name: "Déplier le sommaire" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("grand-oral-studio:sommaire-replie")).toBe("1");
    await user.click(expand);
    expect(window.localStorage.getItem("grand-oral-studio:sommaire-replie")).toBe("0");
  });

  it("devrait rester déplié sur écran étroit, même replié auparavant sur grand écran", () => {
    window.localStorage.setItem("grand-oral-studio:sommaire-replie", "1");
    wide = false;
    render(<SettingsToc />);
    expect(screen.getByRole("link", { name: /Clé API Anthropic/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Déplier le sommaire" })).not.toBeInTheDocument();
  });

  it("devrait suivre la partie visible au défilement", () => {
    render(<SettingsToc />);
    act(() => {
      observerCallback([
        { target: document.getElementById("section-cle-api")!, isIntersecting: true, boundingClientRect: { top: 40 } as DOMRect },
      ]);
    });
    expect(screen.getByRole("link", { name: /Clé API Anthropic/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Moteur de rédaction/ })).not.toHaveAttribute("aria-current");
  });

  it("devrait aller à la partie au clic : défilement, focus sur son titre, fragment dans l'URL", async () => {
    const user = userEvent.setup();
    render(<SettingsToc />);
    await user.click(screen.getByRole("link", { name: /Clé API Anthropic/ }));
    expect(document.getElementById("section-cle-api")!.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.getElementById("cle-api")).toHaveFocus();
    expect(window.location.hash).toBe("#cle-api");
    expect(screen.getByRole("link", { name: /Clé API Anthropic/ })).toHaveAttribute("aria-current", "page");
  });

  it("devrait retenir la dernière partie quand la page est tout en bas", () => {
    render(<SettingsToc />);
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("scrollY", 1200);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("link", { name: /Clé API Anthropic/ })).toHaveAttribute("aria-current", "page");
  });

  it("devrait défiler sans animation quand l'appareil limite les mouvements", async () => {
    systemReducedMotion = true;
    const user = userEvent.setup();
    render(<SettingsToc />);
    await user.click(screen.getByRole("link", { name: /Clé API Anthropic/ }));
    expect(document.getElementById("section-cle-api")!.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("devrait défiler sans animation quand « Réduire les animations » est activé dans Réglages", async () => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, serializePreferences({ textSize: "standard", motion: "reduced" }));
    const user = userEvent.setup();
    render(<SettingsToc />);
    await user.click(screen.getByRole("link", { name: /Clé API Anthropic/ }));
    expect(document.getElementById("section-cle-api")!.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });
});
