import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/components/auth/next-path";

describe("safeNextPath", () => {
  it("conserve un chemin interne avec sa requête", () => {
    expect(safeNextPath("/projets/abc/jour-j?x=1")).toBe("/projets/abc/jour-j?x=1");
  });

  it.each([
    ["absent", undefined],
    ["URL absolue", "https://evil.example/"],
    ["schéma relatif", "//evil.example"],
    ["antislash", "/\\evil.example"],
    ["tabulation", "/\t/evil.example"],
    ["saut de ligne", "/\n/evil.example"],
    ["tabulation + antislash", "/\t\\evil.example"],
    ["chemin relatif", "programmes"],
    ["segment point", "/.//evil.example/x"],
    ["segment point-point", "/a/..//evil.example"],
    ["point encodé", "/%2e//evil.example"],
  ])("renvoie la valeur de repli pour %s", (_cas, valeur) => {
    expect(safeNextPath(valeur)).toBe("/projets");
  });

  it("prend la première valeur d'un paramètre répété", () => {
    expect(safeNextPath(["/projets/a", "//evil.example"])).toBe("/projets/a");
  });
});
