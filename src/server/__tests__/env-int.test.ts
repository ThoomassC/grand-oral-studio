import { describe, expect, it } from "vitest";
import { envPositiveInt } from "@/server/rate-limit";

describe("envPositiveInt", () => {
  it.each([
    [undefined, 80],
    ["", 80],
    ["  ", 80],
    ["0", 80],
    ["-3", 80],
    ["1.5", 80],
    ["abc", 80],
    ["200", 200],
    [" 15 ", 15],
  ])("devrait lire %o comme %i (défaut 80)", (value, expected) => {
    expect(envPositiveInt(value, 80)).toBe(expected);
  });
});
