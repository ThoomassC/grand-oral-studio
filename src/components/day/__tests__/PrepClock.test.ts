import { describe, expect, it } from "vitest";
import { formatDuration, spokenDuration } from "@/components/day/PrepClock";

describe("durées", () => {
  it("devrait écrire la forme visuelle compacte", () => {
    expect(formatDuration(90)).toBe("1 h 30");
    expect(formatDuration(20)).toBe("20 min");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("devrait donner une forme lisible par un lecteur d'écran", () => {
    expect(spokenDuration(90)).toBe("1 heure 30");
    expect(spokenDuration(87)).toBe("1 heure 27");
    expect(spokenDuration(20)).toBe("20 minutes");
    expect(spokenDuration(1)).toBe("1 minute");
    expect(spokenDuration(120)).toBe("2 heures");
    expect(spokenDuration(125)).toBe("2 heures 05");
  });
});
