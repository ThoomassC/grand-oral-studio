import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chronomètre de préparation réel : démarrage à la première saisie (ou au
 * collage) de la problématique, persistance dans localStorage, pause, reprise
 * et remise à zéro. Seule la date est simulée : l'intervalle d'une seconde
 * reste réel (rafraîchissements attendus avec findBy*).
 */

const generate = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/actions/generation", () => ({
  classifyProblem: vi.fn(),
  generateFinalDeck: (...args: unknown[]) => generate(...args),
}));

const { PrepCountdown } = await import("@/components/day/PrepCountdown");
const { DayJourney } = await import("@/components/day/DayJourney");

const KEY = "grand-oral-studio:prep:p1";
const START = new Date("2026-10-07T08:00:00.000Z").getTime();
const MINUTE = 60_000;
const PROBLEM = "Comment les PME peuvent-elles financer leur transition ?";
const WRITER: Parameters<typeof DayJourney>[0]["writer"] = {
  label: "Sans IA",
  outlineOnly: true,
  waitHint: "Cela prend quelques secondes.",
  engine: "free",
  keySource: null,
  ready: true,
  problem: null,
};
const TICK = { timeout: 2500 };

/** Node ≥ 22 expose son propre localStorage, incomplet : stockage en mémoire (comme SiteSettings.test). */
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

function stored(): { v: number; startedAt: number; pausedAt?: number } | null {
  const raw = window.localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as { v: number; startedAt: number; pausedAt?: number }) : null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  vi.stubGlobal("localStorage", memoryStorage());
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  generate.mockReset();
});

describe("PrepCountdown — avant le départ", () => {
  it("devrait afficher la durée de préparation de la trame, sans bouton", () => {
    render(<PrepCountdown storageKey={KEY} minutes={120} />);
    expect(screen.getByText("2 h")).toBeInTheDocument();
    expect(screen.getByText("de préparation")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("PrepCountdown — démarrage à la saisie de la problématique", () => {
  it("devrait démarrer au collage de la problématique et envoyer le départ à la génération", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d1", warnings: [], reused: false, engine: "free" } });
    const user = userEvent.setup();
    render(
      <>
        <PrepCountdown storageKey={KEY} minutes={90} />
        <DayJourney programId="p1" themes={[]} recentDeck={null} writer={WRITER} prepKey={KEY} />
      </>,
    );
    expect(stored()).toBeNull();
    await user.click(screen.getByLabelText("Problématique tirée au sort"));
    await user.paste(PROBLEM);
    expect(stored()).toEqual({ v: 1, startedAt: START });
    expect(await screen.findByText("restantes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    // Une saisie suivante ne relance pas le chrono.
    vi.setSystemTime(START + 2 * MINUTE);
    await user.type(screen.getByLabelText("Problématique tirée au sort"), " ");
    expect(stored()).toEqual({ v: 1, startedAt: START });

    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM, {
      practice: false,
      prepStartedAt: new Date(START).toISOString(),
      override: null,
    });
  });
});

describe("PrepCountdown — persistance", () => {
  it("devrait reprendre le décompte après un rechargement", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, startedAt: START - 20 * MINUTE }));
    const first = render(<PrepCountdown storageKey={KEY} minutes={90} />);
    expect(await screen.findByText("1 h 10")).toBeInTheDocument();
    first.unmount();

    vi.setSystemTime(START + 5 * MINUTE);
    render(<PrepCountdown storageKey={KEY} minutes={90} />);
    expect(await screen.findByText("1 h 05", undefined, TICK)).toBeInTheDocument();
    expect(screen.getByText("Diaporama à générer")).toBeInTheDocument();
  });

  it("devrait ignorer un départ de plus de 6 h (session oubliée)", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, startedAt: START - 7 * 60 * MINUTE }));
    render(<PrepCountdown storageKey={KEY} minutes={90} />);
    expect(screen.getByText("de préparation")).toBeInTheDocument();
  });

  it("devrait annoncer la fin de la préparation", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, startedAt: START - 95 * MINUTE }));
    render(<PrepCountdown storageKey={KEY} minutes={90} />);
    expect(await screen.findByText("0 min")).toBeInTheDocument();
    expect(screen.getByText("temps écoulé")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });
});

describe("PrepCountdown — pause, reprise, remise à zéro", () => {
  it("devrait figer le décompte en pause, le reprendre là où il en était, puis le remettre à zéro", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, startedAt: START - 20 * MINUTE }));
    const user = userEvent.setup();
    render(<PrepCountdown storageKey={KEY} minutes={90} />);
    await user.click(await screen.findByRole("button", { name: "Pause" }));
    expect(stored()).toEqual({ v: 1, startedAt: START - 20 * MINUTE, pausedAt: START });
    expect(screen.getByText("en pause")).toBeInTheDocument();

    vi.setSystemTime(START + 10 * MINUTE);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(screen.getByText("1 h 10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reprendre" }));
    expect(stored()).toEqual({ v: 1, startedAt: START - 10 * MINUTE });
    expect(screen.getByText("1 h 10")).toBeInTheDocument();
    vi.setSystemTime(START + 11 * MINUTE);
    expect(await screen.findByText("1 h 09", undefined, TICK)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Réinitialiser" }));
    expect(stored()).toBeNull();
    expect(screen.getByText("1 h 30")).toBeInTheDocument();
    expect(screen.getByText("de préparation")).toBeInTheDocument();
  });
});
