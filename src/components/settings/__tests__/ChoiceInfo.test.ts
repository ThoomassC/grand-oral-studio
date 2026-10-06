import { describe, expect, it } from "vitest";
import { infoPlacement } from "@/components/settings/ChoiceInfo";

describe("infoPlacement — côté du panneau « i »", () => {
  // Panneau de 16,5 rem à 16 px = 264 px, plus 12 px d'écart et 16 px de marge à l'écran.
  it("devrait ouvrir à droite du bouton quand le panneau y tient, pour laisser le contenu visible", () => {
    expect(infoPlacement({ triggerRight: 1000, viewportWidth: 1440, rootFontSize: 16 })).toBe("right");
    expect(infoPlacement({ triggerRight: 1000, viewportWidth: 1292, rootFontSize: 16 })).toBe("right");
  });

  it("devrait ouvrir en dessous quand la place manque à droite (téléphone, fenêtre étroite)", () => {
    expect(infoPlacement({ triggerRight: 1000, viewportWidth: 1291, rootFontSize: 16 })).toBe("bottom");
    expect(infoPlacement({ triggerRight: 340, viewportWidth: 375, rootFontSize: 16 })).toBe("bottom");
  });

  it("devrait suivre la taille du texte choisie dans les Réglages (panneau en rem)", () => {
    // 125 % : 16,5 rem = 330 px ; 1000 + 330 + 12 + 16 = 1358.
    expect(infoPlacement({ triggerRight: 1000, viewportWidth: 1357, rootFontSize: 20 })).toBe("bottom");
    expect(infoPlacement({ triggerRight: 1000, viewportWidth: 1358, rootFontSize: 20 })).toBe("right");
  });
});
