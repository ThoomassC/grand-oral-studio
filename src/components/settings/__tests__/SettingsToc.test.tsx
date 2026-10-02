import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
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
    matches: q.includes("min-width") ? wide : false,
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
});

describe("SettingsToc", () => {
  it("devrait proposer un sommaire nommé avec un lien par partie", () => {
    render(<SettingsToc />);
    const nav = screen.getByRole("navigation", { name: "Sommaire des paramètres" });
    const links = [...nav.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#moteur", "#cle-api", "#apparence"]);
    expect(screen.getByRole("link", { name: /Moteur de rédaction/ })).toHaveAttribute("aria-current", "page");
  });

  it("devrait ranger les entrées en parties nommées « Rédaction » et « Interface »", () => {
    render(<SettingsToc />);
    const redaction = screen.getByRole("group", { name: "Rédaction" });
    expect([...redaction.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#moteur", "#cle-api"]);
    const ui = screen.getByRole("group", { name: "Interface" });
    expect([...ui.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#apparence"]);
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
    expect(screen.getByRole("link", { name: /Apparence/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Déplier le sommaire" })).not.toBeInTheDocument();
  });

  it("devrait suivre la partie visible au défilement", () => {
    render(<SettingsToc />);
    act(() => {
      observerCallback([
        { target: document.getElementById("section-apparence")!, isIntersecting: true, boundingClientRect: { top: 40 } as DOMRect },
      ]);
    });
    expect(screen.getByRole("link", { name: /Apparence/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Moteur de rédaction/ })).not.toHaveAttribute("aria-current");
  });

  it("devrait aller à la partie au clic : défilement, focus sur son titre, fragment dans l'URL", async () => {
    const user = userEvent.setup();
    render(<SettingsToc />);
    await user.click(screen.getByRole("link", { name: /Clé API Anthropic/ }));
    expect(document.getElementById("section-cle-api")!.scrollIntoView).toHaveBeenCalled();
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
    expect(screen.getByRole("link", { name: /Apparence/ })).toHaveAttribute("aria-current", "page");
  });
});
