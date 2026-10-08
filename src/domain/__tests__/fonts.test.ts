import { describe, expect, it } from "vitest";
import { FONT_NOT_EMBEDDED_WARNING, fontWarning, SAFE_FONTS, SYSTEM_FONTS } from "@/domain/fonts";

const WARNING =
  "Cette police n'est pas incluse dans le fichier PowerPoint : sur un ordinateur qui ne l'a pas, elle sera remplacée et le texte peut déborder.";

describe("fontWarning", () => {
  it.each(["Arial", "Calibri", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman"])(
    "ne devrait rien signaler pour %s, installée avec Windows, macOS ou Office",
    (font) => {
      expect(fontWarning(font)).toBeNull();
    },
  );

  it.each(["Montserrat", "Open Sans", "Roboto", "Lato", "Poppins"])(
    "devrait prévenir que %s n'est pas incluse dans le .pptx",
    (font) => {
      expect(fontWarning(font)).toBe(WARNING);
    },
  );

  it("devrait prévenir aussi pour une police hors liste (charte ancienne ou importée)", () => {
    expect(fontWarning("Aptos")).toBe(WARNING);
  });

  it("devrait comparer le nom exact : une casse différente n'est pas la police système", () => {
    expect(fontWarning("arial")).toBe(WARNING);
  });

  it("devrait exposer le message tel quel", () => {
    expect(FONT_NOT_EMBEDDED_WARNING).toBe(WARNING);
  });

  it("ne devrait déclarer comme sûres que des polices de la liste autorisée", () => {
    for (const font of SYSTEM_FONTS) expect(SAFE_FONTS).toContain(font);
  });
});
