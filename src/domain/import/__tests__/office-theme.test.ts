import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ImportFileError } from "@/domain/import/errors";
import { extractOfficeTheme, OFFICE_IMPORT_LIMITS } from "@/domain/import/office-theme";
import { buildManyEntries, buildPptx, buildThmx, buildXmlBomb, JPEG_HEADER, PNG_1PX, themeXml } from "./fixtures";

describe("extractOfficeTheme — .pptx", () => {
  it("devrait lire les couleurs, les polices et le nom du thème lié au premier masque", async () => {
    const pptx = await buildPptx({
      name: "Bleu Nuit",
      colors: { dk1: "1A1A2E", lt1: "FAFAFA", accent1: "0F4C81", accent2: "E94560", accent3: "16C79A" },
      major: "Georgia",
      minor: "Lato",
    });
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(t.name).toBe("Bleu Nuit");
    expect(t.colors).toMatchObject({ dk1: "#1A1A2E", lt1: "#FAFAFA", accent1: "#0F4C81", accent2: "#E94560", accent3: "#16C79A" });
    expect(t.colors.accent6).toBe("#70AD47");
    expect(t.fonts).toEqual({ major: "Georgia", minor: "Lato" });
    expect(t.logoDataUrl).toBeNull();
  });

  it("devrait suivre les .rels du masque plutôt que supposer theme1.xml", async () => {
    const pptx = await buildPptx({ themeFile: "theme7.xml", name: "Le vrai", colors: { accent1: "ABCDEF" } });
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(t.name).toBe("Le vrai");
    expect(t.colors.accent1).toBe("#ABCDEF");
  });

  it("devrait lire une couleur système via lastClr", async () => {
    const pptx = await buildPptx({ sysColors: { dk1: "222222", lt1: "FEFEFE" } });
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(t.colors.dk1).toBe("#222222");
    expect(t.colors.lt1).toBe("#FEFEFE");
  });

  it("devrait extraire le logo PNG du masque en data URL", async () => {
    const pptx = await buildPptx({ logo: { bytes: PNG_1PX, ext: "png" } });
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(t.logoDataUrl).toBe(`data:image/png;base64,${Buffer.from(PNG_1PX).toString("base64")}`);
  });

  it("devrait chercher le logo dans le premier layout si le masque n'en a pas", async () => {
    const pptx = await buildPptx({ logo: { bytes: JPEG_HEADER, ext: "jpeg", where: "layout" } });
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(t.logoDataUrl?.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("devrait ignorer une image qui n'est ni PNG ni JPEG (signature vérifiée)", async () => {
    const pptx = await buildPptx({ logo: { bytes: new TextEncoder().encode("GIF89a...."), ext: "gif" } });
    expect((await extractOfficeTheme(pptx, "pptx")).logoDataUrl).toBeNull();
    const lying = await buildPptx({ logo: { bytes: new TextEncoder().encode("<svg/>"), ext: "png" } });
    expect((await extractOfficeTheme(lying, "pptx")).logoDataUrl).toBeNull();
  });

  it("devrait ignorer un logo de plus de 500 Ko, en le signalant", async () => {
    const big = new Uint8Array(600 * 1024);
    big.set(PNG_1PX.subarray(0, 8));
    const t = await extractOfficeTheme(await buildPptx({ logo: { bytes: big, ext: "png" } }), "pptx");
    expect(t.logoDataUrl).toBeNull();
    expect(t.notes.join(" ")).toMatch(/Logo ignoré/);
  });

  it("devrait refuser un fichier avec macros", async () => {
    await expect(extractOfficeTheme(await buildPptx({ macro: true }), "pptx")).rejects.toBeInstanceOf(ImportFileError);
  });

  it("devrait refuser un thème qui déclare une DTD ou des entités", async () => {
    const pptx = await buildPptx({
      extra: (zip: JSZip) =>
        zip.file("ppt/theme/theme1.xml", `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>${themeXml()}`),
    });
    await expect(extractOfficeTheme(pptx, "pptx")).rejects.toBeInstanceOf(ImportFileError);
  });
});

describe("extractOfficeTheme — .thmx", () => {
  it("devrait lire theme/theme/theme1.xml, sans logo", async () => {
    const t = await extractOfficeTheme(await buildThmx({ name: "Maison", colors: { accent1: "123456" }, major: "Montserrat" }), "thmx");
    expect(t.name).toBe("Maison");
    expect(t.colors.accent1).toBe("#123456");
    expect(t.fonts.major).toBe("Montserrat");
    expect(t.logoDataUrl).toBeNull();
  });
});

describe("extractOfficeTheme — archives piégées", () => {
  it("devrait refuser un fichier qui n'est pas une archive", async () => {
    await expect(extractOfficeTheme(new TextEncoder().encode("pas un zip"), "pptx")).rejects.toBeInstanceOf(ImportFileError);
  });

  it("devrait refuser un fichier de plus de 20 Mo sans le lire", async () => {
    const huge = new Uint8Array(OFFICE_IMPORT_LIMITS.fileBytes + 1);
    await expect(extractOfficeTheme(huge, "pptx")).rejects.toThrow(/20 Mo/);
  });

  it("devrait refuser plus de 2 000 entrées", async () => {
    await expect(extractOfficeTheme(await buildManyEntries(2_001), "thmx")).rejects.toThrow(/entrées/);
  });

  it("devrait interrompre la décompression d'un XML au-delà de 5 Mo (bombe)", async () => {
    const bomb = await buildXmlBomb();
    expect(bomb.byteLength).toBeLessThan(200 * 1024);
    await expect(extractOfficeTheme(bomb, "pptx")).rejects.toThrow(/volumineux/);
  });

  it("devrait refuser une archive sans thème", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "x");
    await expect(extractOfficeTheme(await zip.generateAsync({ type: "uint8array" }), "thmx")).rejects.toThrow(/thème/);
  });
});
