import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREFERENCES_STORAGE_KEY, serializePreferences } from "@/components/preferences/preferences";
import {
  getPreferencesSnapshot,
  prefersReducedMotion,
  resetPreferencesStoreForTests,
  setPreferences,
  updatePreferences,
  usePreferences,
} from "@/components/preferences/store";

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

function mockSystemReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })),
  );
}

const html = () => document.documentElement;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  mockSystemReducedMotion(false);
  html().removeAttribute("data-text-size");
  html().removeAttribute("data-motion");
  resetPreferencesStoreForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const p = usePreferences();
  return (
    <p>
      {p.textSize} / {p.motion}
    </p>
  );
}

describe("magasin des réglages", () => {
  it("devrait rendre un instantané stable tant que le stockage ne change pas", () => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, serializePreferences({ textSize: "large", motion: "system" }));
    const a = getPreferencesSnapshot();
    expect(a).toEqual({ textSize: "large", motion: "system" });
    expect(getPreferencesSnapshot()).toBe(a);
  });

  it("devrait appliquer, mémoriser et notifier à l'écriture", () => {
    render(<Probe />);
    expect(screen.getByText("standard / system")).toBeInTheDocument();
    act(() => {
      expect(updatePreferences({ textSize: "xlarge" })).toBe(true);
    });
    expect(screen.getByText("xlarge / system")).toBeInTheDocument();
    expect(html()).toHaveAttribute("data-text-size", "xlarge");
    expect(html()).toHaveAttribute("data-motion", "system");
    expect(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(serializePreferences({ textSize: "xlarge", motion: "system" }));
  });

  it("devrait suivre un changement fait dans un autre onglet (événement storage)", () => {
    render(<Probe />);
    const raw = serializePreferences({ textSize: "large", motion: "reduced" });
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, raw);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PREFERENCES_STORAGE_KEY, newValue: raw }));
    });
    expect(screen.getByText("large / reduced")).toBeInTheDocument();
    expect(html()).toHaveAttribute("data-text-size", "large");
    expect(html()).toHaveAttribute("data-motion", "reduced");
  });

  it("devrait ignorer l'événement storage d'une autre clé", () => {
    render(<Probe />);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
    });
    expect(html()).not.toHaveAttribute("data-text-size");
  });

  it("devrait appliquer le réglage pour la visite quand le stockage lève", () => {
    const broken = memoryStorage();
    broken.getItem = () => {
      throw new Error("SecurityError");
    };
    broken.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", broken);
    render(<Probe />);
    expect(screen.getByText("standard / system")).toBeInTheDocument();
    act(() => {
      expect(setPreferences({ textSize: "large", motion: "reduced" })).toBe(false);
    });
    expect(screen.getByText("large / reduced")).toBeInTheDocument();
    expect(html()).toHaveAttribute("data-motion", "reduced");
  });

  it("devrait garder la valeur de la visite quand seule l'écriture échoue", () => {
    const full = memoryStorage();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", full);
    render(<Probe />);
    act(() => {
      expect(updatePreferences({ motion: "reduced" })).toBe(false);
    });
    expect(screen.getByText("standard / reduced")).toBeInTheDocument();
  });
});

describe("prefersReducedMotion", () => {
  it("devrait suivre l'appareil par défaut", () => {
    expect(prefersReducedMotion()).toBe(false);
    mockSystemReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("devrait réduire quand le réglage le demande, quel que soit l'appareil", () => {
    updatePreferences({ motion: "reduced" });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("devrait tolérer l'absence de matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
