import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREP_MINUTES,
  formatRemaining,
  milestones,
  parsePrepState,
  prepMinutesOf,
  remainingMs,
  serializePrepState,
  storageKey,
} from "@/domain/prep-clock";
import { makeTemplate } from "@/test/fixtures";

const MIN = 60_000;
const START = Date.UTC(2026, 5, 15, 8, 0, 0);

describe("prepMinutesOf", () => {
  it("devrait valoir 90 min par défaut", () => {
    expect(DEFAULT_PREP_MINUTES).toBe(90);
    expect(prepMinutesOf(makeTemplate())).toBe(90);
    expect(prepMinutesOf(null)).toBe(90);
  });

  it("devrait lire prepMinutes quand la trame le porte", () => {
    expect(prepMinutesOf({ ...makeTemplate(), prepMinutes: 120 } as never)).toBe(120);
  });

  it.each([5, 241, 12.5, Number.NaN, "60"])("devrait revenir à 90 quand prepMinutes vaut %s", (prepMinutes) => {
    expect(prepMinutesOf({ ...makeTemplate(), prepMinutes } as never)).toBe(90);
  });
});

describe("remainingMs", () => {
  it("devrait décompter depuis le départ", () => {
    expect(remainingMs(START, START + 10 * MIN, 90)).toBe(80 * MIN);
  });

  it("devrait s'arrêter à 0 une fois le temps écoulé", () => {
    expect(remainingMs(START, START + 200 * MIN, 90)).toBe(0);
  });

  it("devrait renvoyer la durée entière quand l'horloge est antérieure au départ", () => {
    expect(remainingMs(START, START - MIN, 90)).toBe(90 * MIN);
  });

  it("devrait accepter des dates", () => {
    expect(remainingMs(new Date(START), new Date(START + 30 * MIN), 90)).toBe(60 * MIN);
  });
});

describe("formatRemaining", () => {
  it.each([
    { ms: 72 * MIN, text: "1 h 12" },
    { ms: 65 * MIN, text: "1 h 05" },
    { ms: 60 * MIN, text: "1 h" },
    { ms: 90 * MIN - 1, text: "1 h 30" },
    { ms: 8 * MIN, text: "8 min" },
    { ms: 30_000, text: "1 min" },
    { ms: 0, text: "0 min" },
    { ms: -5_000, text: "0 min" },
    { ms: Number.NaN, text: "0 min" },
  ])("devrait écrire $ms ms « $text »", ({ ms, text }) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});

describe("milestones", () => {
  it("devrait proposer de générer le diaporama tant qu'il reste plus de 45 min", () => {
    const m = milestones(80 * MIN);
    expect(m.current).toBe("generate");
    expect(m.items.map((i) => i.label)).toEqual(["Diaporama à générer", "Reste 45 min : répétez", "Dernières minutes"]);
    expect(m.items.map((i) => i.state)).toEqual(["current", "upcoming", "upcoming"]);
  });

  it("devrait passer à la répétition à 45 min pile", () => {
    const m = milestones(45 * MIN);
    expect(m.current).toBe("rehearse");
    expect(m.items.map((i) => i.state)).toEqual(["past", "current", "upcoming"]);
  });

  it("devrait annoncer les dernières minutes à 10 min", () => {
    expect(milestones(10 * MIN).current).toBe("final");
  });

  it("devrait être terminé à 0", () => {
    const m = milestones(0);
    expect(m.current).toBe("over");
    expect(m.items.every((i) => i.state === "past")).toBe(true);
  });
});

describe("storageKey", () => {
  it("devrait préfixer l'identifiant du projet", () => {
    expect(storageKey("prog_1")).toBe("grand-oral-studio:prep:prog_1");
  });
});

describe("parsePrepState / serializePrepState", () => {
  it("devrait relire l'état qu'il a écrit", () => {
    expect(parsePrepState(serializePrepState({ startedAt: START }), START + MIN)).toEqual({ startedAt: START });
  });

  it.each([
    { label: "absent", raw: null },
    { label: "vide", raw: "" },
    { label: "JSON invalide", raw: "{oops" },
    { label: "mauvaise version", raw: JSON.stringify({ v: 2, startedAt: START }) },
    { label: "départ non entier", raw: JSON.stringify({ v: 1, startedAt: 1.5 }) },
    { label: "départ textuel", raw: JSON.stringify({ v: 1, startedAt: "hier" }) },
    { label: "tableau", raw: "[]" },
  ])("devrait renvoyer null pour un état $label", ({ raw }) => {
    expect(parsePrepState(raw, START)).toBeNull();
  });

  it("devrait rejeter un départ dans le futur", () => {
    expect(parsePrepState(serializePrepState({ startedAt: START + 1 }), START)).toBeNull();
  });

  it("devrait rejeter un départ de plus de 6 h", () => {
    expect(parsePrepState(serializePrepState({ startedAt: START }), START + 6 * 60 * MIN + 1)).toBeNull();
  });

  it("devrait accepter un départ d'exactement 6 h", () => {
    expect(parsePrepState(serializePrepState({ startedAt: START }), START + 6 * 60 * MIN)).toEqual({ startedAt: START });
  });
});
