import { describe, expect, it } from "vitest";
import { infoPlacement } from "@/components/settings/ChoiceInfo";

describe("infoPlacement — fenêtre « i » dans la marge droite, après la carte", () => {
  // Écart de 12 px après la carte, 8 px de marge au bord de l'écran (Opale).
  it("devrait se caler après le bord droit de la carte, pleine largeur (16,5 rem) quand la marge le permet", () => {
    expect(infoPlacement({ triggerRight: 1180, cardRight: 1200, viewportWidth: 1600, rootFontSize: 16 })).toEqual({
      side: "right",
      offset: 32, // 1200 − 1180 + 12 : le panneau commence 12 px après la carte, pas après le bouton.
      width: 264,
    });
  });

  it("devrait rétrécir pour tenir dans une marge plus étroite (écran de 1000 px)", () => {
    // Marge : 1000 − 805 − 12 − 8 = 175 px.
    expect(infoPlacement({ triggerRight: 785, cardRight: 805, viewportWidth: 1000, rootFontSize: 16 })).toEqual({
      side: "right",
      offset: 32,
      width: 175,
    });
  });

  it("devrait passer sous le bouton quand la marge est trop étroite (moins de 10,5 rem : tablette, téléphone)", () => {
    expect(infoPlacement({ triggerRight: 340, cardRight: 359, viewportWidth: 375, rootFontSize: 16 })).toEqual({ side: "bottom" });
    expect(infoPlacement({ triggerRight: 785, cardRight: 805, viewportWidth: 992, rootFontSize: 16 })).toEqual({ side: "bottom" });
  });

  it("devrait suivre la taille du texte choisie dans les Réglages (largeurs en rem)", () => {
    // 125 % : minimum 10,5 rem = 210 px ; marge 1000 − 805 − 20 = 175 px → sous le bouton.
    expect(infoPlacement({ triggerRight: 785, cardRight: 805, viewportWidth: 1000, rootFontSize: 20 })).toEqual({ side: "bottom" });
  });
});
