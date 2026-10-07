import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RehearsalSlide } from "@/components/rehearsal/RehearsalPlayer";
import type { SlideBrand } from "@/components/slides/SlidePreview";

const saveRehearsal = vi.fn();
vi.mock("@/server/actions/practice", () => ({ saveRehearsal: (...args: unknown[]) => saveRehearsal(...args) }));

const { RehearsalPlayer } = await import("@/components/rehearsal/RehearsalPlayer");

const BRAND: SlideBrand = {
  colors: { primary: "#1F4E79", secondary: "#5B8DB8", accent: "#E07A1F", background: "#FFFFFF", text: "#222222" },
  fonts: { heading: "Arial", body: "Arial" },
  logoDataUrl: null,
};

const SLIDES: RehearsalSlide[] = [
  { layout: "title", title: "Couverture du sujet", subtitle: "", bullets: [], notes: "Se présenter calmement." },
  { layout: "content", title: "Un constat chiffré", subtitle: "", bullets: ["Part de la voiture"], notes: "Citer deux chiffres." },
  { layout: "conclusion", title: "Vers une mobilité choisie", subtitle: "", bullets: [], notes: "Conclure en une minute." },
];

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-07T08:00:00Z") });
  saveRehearsal.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  render(
    <RehearsalPlayer
      deckId="d1"
      deckTitle="Faut-il repenser nos mobilités"
      slides={SLIDES}
      planned={[30, 30, 30]}
      brand={BRAND}
      format="16:9"
      backHref="/projets/p1/decks/d1"
    />,
  );
}

/** Clic (horloge simulée : fireEvent plutôt que user-event, comme CanvaPanel.test.tsx). */
async function click(name: string | RegExp, scope: HTMLElement = document.body) {
  await act(async () => {
    fireEvent.click(within(scope).getByRole("button", { name }));
  });
}

/** Touche pressée sur le corps de la page (les raccourcis écoutent le document). */
function press(key: string, target: Element = document.body) {
  act(() => {
    fireEvent.keyDown(target, { key });
  });
}

/** Laisse passer `seconds` secondes d'horloge (et les rafraîchissements du minuteur). */
function elapse(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

const position = () => screen.getByText(/^Diapo \d sur 3$/).textContent;

describe("RehearsalPlayer — navigation", () => {
  it("devrait passer d'une diapo à l'autre au clavier (flèches, Espace) et par les vignettes", async () => {
    setup();
    expect(position()).toBe("Diapo 1 sur 3");
    expect(screen.getByText("Se présenter calmement.")).toBeInTheDocument();

    await click("Commencer la répétition");
    press("ArrowRight");
    expect(position()).toBe("Diapo 2 sur 3");
    expect(screen.getByText("Citer deux chiffres.")).toBeInTheDocument();

    // Espace sur le corps de la page : diapo suivante ; sur un bouton, il garde son effet natif.
    press(" ", screen.getByRole("button", { name: "Pause" }));
    expect(position()).toBe("Diapo 2 sur 3");
    press(" ");
    expect(position()).toBe("Diapo 3 sur 3");
    press("ArrowRight");
    expect(position()).toBe("Diapo 3 sur 3");

    press("ArrowLeft");
    expect(position()).toBe("Diapo 2 sur 3");

    const strip = screen.getByRole("navigation", { name: "Diapos du diaporama" });
    await click(/^Diapo 1 :/, strip);
    expect(position()).toBe("Diapo 1 sur 3");
    expect(within(strip).getByRole("button", { name: /^Diapo 1 :/ })).toHaveAttribute("aria-current", "step");
  });

  it("devrait afficher l'écart en direct sur la diapo courante", async () => {
    setup();
    await click("Commencer la répétition");
    elapse(40);
    const timers = screen.getByRole("group", { name: "Minuteurs" });
    expect(within(timers).getByText("+10 s")).toBeInTheDocument();
    expect(within(timers).getAllByText("0:40")).toHaveLength(2);
  });

  it("ne devrait pas compter le temps passé en pause", async () => {
    setup();
    await click("Commencer la répétition");
    elapse(10);
    await click("Pause");
    elapse(60);
    await click("Reprendre");
    elapse(5);
    saveRehearsal.mockResolvedValue({ ok: true, data: { rehearsal: { id: "r1" } } });
    await click("Terminer");
    expect(saveRehearsal).toHaveBeenCalledWith("d1", { totalSeconds: 15, perSlide: [15, 0, 0] });
  });
});

describe("RehearsalPlayer — bilan et enregistrement", () => {
  it("devrait afficher le bilan et enregistrer la répétition en terminant", async () => {
    saveRehearsal.mockResolvedValue({ ok: true, data: { rehearsal: { id: "r1" } } });
    setup();
    await click("Commencer la répétition");
    elapse(30);
    press("ArrowRight");
    elapse(50);
    press("ArrowRight");
    elapse(20);
    await click("Terminer");

    expect(saveRehearsal).toHaveBeenCalledWith("d1", { totalSeconds: 100, perSlide: [30, 50, 20] });
    const summary = screen.getByRole("region", { name: "Bilan de la répétition" });
    expect(within(summary).getByText("1:40")).toBeInTheDocument();
    expect(within(summary).getByText("1:30")).toBeInTheDocument();
    expect(within(summary).getByText("+10 s")).toBeInTheDocument();
    const overruns = within(summary).getByRole("list", { name: "Diapos en dépassement" });
    expect(within(overruns).getAllByRole("listitem")).toHaveLength(1);
    expect(overruns).toHaveTextContent("Diapo 2 · Un constat chiffré");
    expect(overruns).toHaveTextContent("+20 s");
    expect(screen.getByText("Répétition enregistrée.")).toBeInTheDocument();
  });

  it("devrait proposer de réessayer l'enregistrement après un échec", async () => {
    saveRehearsal.mockResolvedValueOnce({ ok: false, error: "Ce diaporama est introuvable." });
    setup();
    await click("Commencer la répétition");
    elapse(12);
    await click("Terminer");
    expect(screen.getByRole("alert")).toHaveTextContent("Ce diaporama est introuvable.");

    saveRehearsal.mockResolvedValueOnce({ ok: true, data: { rehearsal: { id: "r1" } } });
    await click("Réessayer l'enregistrement");
    expect(saveRehearsal).toHaveBeenCalledTimes(2);
    expect(saveRehearsal).toHaveBeenLastCalledWith("d1", { totalSeconds: 12, perSlide: [12, 0, 0] });
    expect(screen.getByText("Répétition enregistrée.")).toBeInTheDocument();
  });

  it("ne devrait pas enregistrer une répétition de moins d'une seconde", async () => {
    setup();
    await click("Commencer la répétition");
    await click("Terminer");
    expect(saveRehearsal).not.toHaveBeenCalled();
    expect(screen.getByText(/trop courte pour être enregistrée/)).toBeInTheDocument();
  });

  it("devrait revenir au départ avec « Recommencer »", async () => {
    saveRehearsal.mockResolvedValue({ ok: true, data: { rehearsal: { id: "r1" } } });
    setup();
    await click("Commencer la répétition");
    press("ArrowRight");
    elapse(5);
    await click("Terminer");
    screen.getByText("Répétition enregistrée.");

    await click("Recommencer");
    expect(screen.queryByRole("region", { name: "Bilan de la répétition" })).not.toBeInTheDocument();
    expect(position()).toBe("Diapo 1 sur 3");
    expect(screen.getByRole("button", { name: "Commencer la répétition" })).toBeInTheDocument();
  });
});
