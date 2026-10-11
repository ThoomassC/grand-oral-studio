import { describe, expect, it } from "vitest";
import { postLoginDestination, postLoginPath, safeNextPath, verificationCallbackPath } from "@/components/auth/next-path";

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

describe("destination après la transition du logo", () => {
  it("conserve la requête et l'ancre d'une destination interne", () => {
    const destination = "/projets/abc/jour-j?mode=entrainement#contenu";
    expect(postLoginDestination(destination)).toBe(destination);
    expect(postLoginPath(destination)).toBe(`/connexion/chargement?next=${encodeURIComponent(destination)}`);
  });

  it.each([undefined, "//evil.example", "https://evil.example", "/connexion", "/inscription?next=/connexion", "/connexion/chargement/?next=/connexion", "/connexion/%63hargement", "/connexion/%"])(
    "évite une redirection externe ou une boucle pour %s",
    (destination) => {
      expect(postLoginDestination(destination)).toBe("/projets");
      expect(postLoginPath(destination ?? "/projets")).toBe("/connexion/chargement");
    },
  );
});

describe("verificationCallbackPath", () => {
  it("renvoie vers la connexion, qui redirige vers la destination une fois la session ouverte", () => {
    expect(verificationCallbackPath("/projets")).toBe("/connexion");
    expect(verificationCallbackPath("/projets/abc?x=1")).toBe("/connexion?next=%2Fprojets%2Fabc%3Fx%3D1");
  });

  it("ne transporte jamais une destination externe", () => {
    expect(verificationCallbackPath("//evil.example")).toBe("/connexion");
  });
});
