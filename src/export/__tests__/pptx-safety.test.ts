import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { DeckSpec } from "@/domain/schemas";
import { deckToPptx } from "@/export/pptx";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";

/** Toute esperluette doit ouvrir une entité XML valide. */
const RAW_AMPERSAND = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/;
const XML_FORBIDDEN_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

async function allXml(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const out: Record<string, string> = {};
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".xml") || n.endsWith(".rels"))) {
    out[name] = await zip.file(name)!.async("string");
  }
  return out;
}

describe("deckToPptx — XML bien formé", () => {
  it("devrait produire un docProps/app.xml valide quand la charte s'appelle « Dupont & Fils »", async () => {
    const files = await allXml(await deckToPptx(makeConformingDeck(), makeBrand({ name: "Dupont & Fils <SA>" }), makeTemplate()));
    expect(files["docProps/app.xml"]).toBeDefined();
    for (const [name, xml] of Object.entries(files)) {
      expect(RAW_AMPERSAND.test(xml), name).toBe(false);
    }
  });

  it("devrait échapper un titre de deck avec des caractères spéciaux dans les métadonnées", async () => {
    const deck: DeckSpec = { ...makeConformingDeck(), title: "R&D <publique> : l'avenir" };
    const files = await allXml(await deckToPptx(deck, makeBrand(), makeTemplate()));
    for (const [name, xml] of Object.entries(files)) {
      expect(RAW_AMPERSAND.test(xml), name).toBe(false);
    }
  });

  it("devrait retirer les caractères de contrôle même si le deck n'a pas été validé", async () => {
    const deck = makeConformingDeck();
    const dirty: DeckSpec = {
      ...deck,
      title: "Deck\u0001",
      slides: deck.slides.map((s, i) =>
        i === 3 ? { ...s, title: "Ti\u0000tre", bullets: ["Pu\u0008ce"], notes: "No\u001Ftes" } : s,
      ),
    };
    const files = await allXml(await deckToPptx(dirty, makeBrand(), makeTemplate()));
    for (const [name, xml] of Object.entries(files)) {
      expect(XML_FORBIDDEN_CONTROL.test(xml), name).toBe(false);
    }
    expect(files["ppt/slides/slide4.xml"]).toContain("Titre");
    expect(files["ppt/notesSlides/notesSlide4.xml"]).toContain("Notes");
  });
});
