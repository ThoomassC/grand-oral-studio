import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { deckToPptx } from "@/export/pptx";
import type { PromptTemplate } from "@/domain/schemas";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";

const deck = makeConformingDeck();
const brand = makeBrand();

async function exportZip(template: PromptTemplate = makeTemplate()): Promise<JSZip> {
  return JSZip.loadAsync(await deckToPptx(deck, brand, template));
}

async function readFile(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (file === null) throw new Error(`Fichier absent de l'archive : ${path}`);
  return file.async("string");
}

function filesMatching(zip: JSZip, pattern: RegExp): string[] {
  return Object.keys(zip.files).filter((name) => pattern.test(name));
}

async function slideSizeRatio(template: PromptTemplate): Promise<number> {
  const presentation = await readFile(await exportZip(template), "ppt/presentation.xml");
  const match = /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(presentation);
  if (match === null) throw new Error("p:sldSz introuvable dans ppt/presentation.xml");
  return Number(match[1]) / Number(match[2]);
}

describe("deckToPptx", () => {
  it("devrait renvoyer un Buffer zip non vide", async () => {
    const buffer = await deckToPptx(deck, brand, makeTemplate());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("devrait contenir un fichier ppt/slides/slideN.xml par diapo du deck", async () => {
    const zip = await exportZip();
    expect(filesMatching(zip, /^ppt\/slides\/slide\d+\.xml$/)).toHaveLength(deck.slides.length);
  });

  it.each(deck.slides.map((slide, index) => ({ number: index + 1, title: slide.title })))(
    "devrait écrire le titre « $title » dans le XML de la diapo $number",
    async ({ number, title }) => {
      expect(await readFile(await exportZip(), `ppt/slides/slide${number}.xml`)).toContain(title);
    },
  );

  it("devrait inclure les notes d'orateur dans ppt/notesSlides", async () => {
    const zip = await exportZip();
    expect(filesMatching(zip, /^ppt\/notesSlides\/notesSlide\d+\.xml$/).length).toBeGreaterThan(0);
    // Diapo 4 : note sans apostrophe ni caractère échappé en XML.
    expect(await readFile(zip, "ppt/notesSlides/notesSlide4.xml")).toContain(deck.slides[3].notes);
  });

  it("devrait utiliser la couleur primaire de la charte dans le XML des diapos", async () => {
    const zip = await exportZip();
    const slidesXml = await Promise.all(filesMatching(zip, /^ppt\/slides\/slide\d+\.xml$/).map((path) => readFile(zip, path)));
    const primary = brand.colors.primary.slice(1).toUpperCase();
    expect(slidesXml.join("\n").toUpperCase()).toContain(primary);
  });

  it("devrait produire une présentation au ratio 16:9 quand le gabarit est en 16:9", async () => {
    expect(await slideSizeRatio(makeTemplate({ format: "16:9" }))).toBeCloseTo(16 / 9, 2);
  });

  it("devrait produire une présentation au ratio 4:3 quand le gabarit est en 4:3", async () => {
    expect(await slideSizeRatio(makeTemplate({ format: "4:3" }))).toBeCloseTo(4 / 3, 2);
  });
});

describe("deckToPptx — palette du thème (theme1.xml)", () => {
  it("devrait écrire les couleurs de la charte dans le jeu de couleurs du thème, à la place de celles d'Office", async () => {
    const theme = await readFile(await exportZip(), "ppt/theme/theme1.xml");
    const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(theme)?.[1] ?? "";
    const color = (slot: string) => new RegExp(`<a:${slot}><a:(?:srgbClr val|sysClr val="[^"]*" lastClr)="([0-9A-F]{6})"`).exec(scheme)?.[1];
    expect(color("dk1")).toBe("222222");
    expect(color("lt1")).toBe("FFFFFF");
    expect(color("dk2")).toBe("1F4E79");
    expect(color("accent1")).toBe("1F4E79");
    expect(color("accent2")).toBe("E07A1F");
    expect(color("accent3")).toBe("5B8DB8");
    expect(scheme).not.toContain("4472C4");
    expect(theme).toMatch(/<a:clrScheme name="Charte d'essai"|<a:clrScheme name="Charte d&apos;essai"/);
  });

  it("devrait échapper le nom de la charte dans le XML du thème", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx(deck, makeBrand({ name: 'Charte <"&">' }), makeTemplate()));
    const theme = await readFile(zip, "ppt/theme/theme1.xml");
    expect(theme).toContain('name="Charte &lt;&quot;&amp;&quot;&gt;"');
  });
});

