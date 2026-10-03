import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { brandFromTheme, contrastRatio } from "@/domain/import/brand-from-theme";
import { extractOfficeTheme } from "@/domain/import/office-theme";
import { detectOfficeDefault } from "@/domain/import/office-usage";
import { buildPptx } from "./fixtures";

/**
 * Cas « présentation produite par un générateur » (pptxgenjs, python-pptx,
 * export Canva) : le thème Office par défaut est resté en place, la vraie
 * charte est posée en dur dans les diapositives.
 */

const A = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;

/** Run de texte ; `color` est un hexadécimal, ou un fragment XML brut s'il commence par « < ». */
const run = (text: string, color: string, opts: { sz?: number; font?: string; scheme?: boolean } = {}) =>
  `<a:r><a:rPr lang="fr-FR"${opts.sz ? ` sz="${opts.sz}"` : ""}><a:solidFill>${
    color.startsWith("<") ? color : opts.scheme ? `<a:schemeClr val="${color}"/>` : `<a:srgbClr val="${color}"/>`
  }</a:solidFill>${opts.font ? `<a:latin typeface="${opts.font}"/>` : ""}</a:rPr><a:t>${text}</a:t></a:r>`;

const textShape = (runs: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5000000" cy="700000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${runs}</a:p></p:txBody></p:sp>`;

const rect = (fill: string, cx = 320040, cy = 5394960) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="4" name="R"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  // xmlns redéclaré sur chaque élément, comme le fait le générateur du fichier Keolis.
  `<a:solidFill ${A}>${fill}</a:solidFill><a:effectLst ${A}><a:outerShdw><a:srgbClr val="00FF00"/></a:outerShdw></a:effectLst></p:spPr>` +
  // Le style par défaut d'une forme pointe sur accent1 : il ne doit pas compter.
  `<p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style></p:sp>`;

const slideXml = (bg: string | null, shapes: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ${A} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<p:cSld>${bg ? `<p:bg><p:bgPr><a:solidFill ${A}><a:srgbClr val="${bg}" /></a:solidFill></p:bgPr></p:bg>` : ""}` +
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

const yellow = `<a:srgbClr val="FBE216"/>`;

/** Reproduction minimale du fichier Keolis : thème Office 2013-2022 intact, charte en dur dans les diapos. */
async function buildKeolisLike(): Promise<Uint8Array> {
  return buildPptx({
    name: "Office Theme",
    major: "Calibri Light",
    minor: "Calibri",
    extra: (zip: JSZip) => {
      zip.file(
        "ppt/slides/slide1.xml",
        slideXml(
          "FFFFFF",
          textShape(run("BIG DATA &amp; DÉCISION", "111111", { sz: 3400, font: "Arial" })) + rect(yellow) + rect(yellow),
        ),
      );
      for (let i = 2; i <= 4; i += 1) {
        zip.file(
          `ppt/slides/slide${i}.xml`,
          slideXml(
            "FFFFFF",
            textShape(run("Titre de la diapositive", "111111", { sz: 2600, font: "Arial" })) +
              textShape(
                run("Un paragraphe de texte courant assez long pour peser.", "222222", { sz: 1400, font: "Arial" }) +
                  run("Encore du texte courant dans la même couleur.", "222222", { sz: 1300, font: "Arial" }),
              ) +
              rect(yellow, 1_200_000, 60_000) +
              rect(`<a:srgbClr val="F1F1F1"/>`, 3_000_000, 2_000_000),
          ),
        );
      }
      // Diapo de clôture sur fond noir : minoritaire, elle ne doit pas imposer son fond.
      zip.file(
        "ppt/slides/slide5.xml",
        slideXml("000000", textShape(run("Merci", "FFFFFF", { sz: 4000, font: "Arial" }) + run("!", "F2C811")) + rect(yellow)),
      );
    },
  });
}

/** Thème Office par défaut, diapos sans aucune couleur ni police explicite. */
async function buildDefaultOnly(): Promise<Uint8Array> {
  return buildPptx({
    name: "Office Theme",
    major: "Calibri Light",
    minor: "Calibri",
    extra: (zip: JSZip) => {
      zip.file(
        "ppt/slides/slide1.xml",
        slideXml(null, textShape(`<a:r><a:rPr lang="fr-FR"/><a:t>Sans couleur</a:t></a:r>`)),
      );
    },
  });
}

describe("extractOfficeTheme — usage réel des diapositives", () => {
  it("devrait détecter le thème Office par défaut et lire la charte posée en dur dans les diapos", async () => {
    const t = await extractOfficeTheme(await buildKeolisLike(), "pptx");
    expect(t.officeDefault).toEqual({ colors: true, fonts: true });
    expect(t.usage?.background).toBe("#FFFFFF");
    expect(t.usage?.text).toBe("#222222");
    expect(t.usage?.title).toBe("#111111");
    expect(t.usage?.accents[0]).toBe("#FBE216");
    // Ni l'ombre (effectLst) ni le style par défaut (p:style → accent1) ne comptent.
    expect(t.usage?.accents).not.toContain("#00FF00");
    expect(t.usage?.accents).not.toContain("#4472C4");
    expect(t.usage?.headingFont).toBe("Arial");
    expect(t.usage?.bodyFont).toBe("Arial");
    expect(t.usage?.explicitColors).toBe(true);
  });

  it("devrait résoudre les schemeClr via le clrMap du masque et le thème", async () => {
    const pptx = await buildPptx({
      extra: (zip: JSZip) =>
        zip.file(
          "ppt/slides/slide1.xml",
          slideXml(null, textShape(run("Texte en tx1", "tx1", { scheme: true })) + rect(`<a:schemeClr val="accent2"/>`)),
        ),
    });
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(t.usage?.text).toBe("#000000");
    expect(t.usage?.accents[0]).toBe("#ED7D31");
    // Couleurs du thème seulement : rien d'explicite.
    expect(t.usage?.explicitColors).toBe(false);
  });

  it("devrait appliquer lumMod/lumOff à une couleur de thème", async () => {
    const pptx = await buildPptx({
      extra: (zip: JSZip) =>
        zip.file(
          "ppt/slides/slide1.xml",
          slideXml(null, textShape(run("x", `<a:schemeClr val="bg1"><a:lumMod val="50000"/></a:schemeClr>`))),
        ),
    });
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(t.usage?.text).toBe("#808080");
  });

  it("ne devrait pas avaler le contenu qui suit un élément auto-fermant (<a:effectLst/>, <a:ln/>)", async () => {
    const empty = `<p:sp><p:nvSpPr><p:cNvPr id="9" name="E"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:ln w="1"/><a:effectLst/></p:spPr></p:sp>`;
    const pptx = await buildPptx({
      extra: (zip: JSZip) => zip.file("ppt/slides/slide1.xml", slideXml("FFFFFF", empty + rect(yellow) + `<p:sp><a:effectLst></a:effectLst></p:sp>`)),
    });
    expect((await extractOfficeTheme(pptx, "pptx")).usage?.accents).toEqual(["#FBE216"]);
  });

  it("ne devrait pas signaler un thème personnalisé comme thème par défaut", async () => {
    const t = await extractOfficeTheme(await buildPptx({ colors: { accent1: "0F4C81", accent2: "E94560" }, major: "Georgia" }), "pptx");
    expect(t.officeDefault).toEqual({ colors: false, fonts: false });
  });

  it("devrait analyser en temps linéaire un XML piégé (balises ouvertes jamais fermées)", async () => {
    // ≈ 4,5 Mo : des centaines de milliers d'ouvrantes sans fermante. Une expression
    // `[\s\S]*?</x>` globale rebalaierait la fin du texte à chaque occurrence.
    const trap = "<p:sp><a:ln><a:r><a:solidFill><a:srgbClr val=\"FBE216\">".repeat(80_000);
    const pptx = await buildPptx({ extra: (zip: JSZip) => zip.file("ppt/slides/slide1.xml", slideXml("FFFFFF", trap)) });
    const started = performance.now();
    await extractOfficeTheme(pptx, "pptx");
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("devrait lire en temps linéaire un masque et un thème piégés (logo, clrScheme)", async () => {
    const pptx = await buildPptx({
      extra: (zip: JSZip) => {
        zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree>${"<p:pic><a:blip ".repeat(300_000)}</p:spTree></p:cSld></p:sldMaster>`);
        zip.file("ppt/theme/theme1.xml", `<a:theme name="x">${"<a:clrScheme><a:accent1>".repeat(150_000)}</a:theme>`);
      },
    });
    const started = performance.now();
    const t = await extractOfficeTheme(pptx, "pptx");
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(t.logoDataUrl).toBeNull();
  });

  it.each([
    // Reproduits : 40 000 ouvrantes prenaient 5,5 s (thème), 1,7 s (logo du masque) et 80 s (relations).
    ["une balise <a:theme sans « > »", "ppt/theme/theme1.xml", "<a:theme ".repeat(150_000)],
    ["des <p:pic sans « > » dans le masque", "ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree>${"<p:pic ".repeat(150_000)}`],
    ["des <Relationship sans « > »", "ppt/slideMasters/_rels/slideMaster1.xml.rels", `<Relationships>${"<Relationship ".repeat(80_000)}`],
  ])("devrait analyser en temps linéaire %s (pas de retour arrière quadratique)", async (_label, path, xml) => {
    // ≈ 1 Mo d'ouvrantes jamais refermées : `[^>]*` relirait toute la fin du texte à
    // chaque occurrence (coût quadratique, serveur bloqué) ; `[^<>]*` s'arrête à la suivante.
    // Thème Office par défaut : sans lui, diapos et masque ne sont pas analysés.
    const pptx = await buildPptx({ name: "Office Theme", major: "Calibri Light", minor: "Calibri", extra: (zip: JSZip) => zip.file(path, xml) });
    const started = performance.now();
    await extractOfficeTheme(pptx, "pptx").catch(() => undefined);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("devrait ignorer une table de couleurs qui vise une propriété héritée (constructor, hasOwnProperty)", async () => {
    const master = `<p:sldMaster><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg></p:cSld><p:clrMap bg1="constructor" tx1="hasOwnProperty" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:sldMaster>`;
    const slide = `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>Texte</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const pptx = await buildPptx({
      extra: (zip: JSZip) => {
        zip.file("ppt/slideMasters/slideMaster1.xml", master);
        zip.file("ppt/slides/slide1.xml", slide);
      },
    });
    const t = await extractOfficeTheme(pptx, "pptx");
    for (const hex of [t.usage?.background, t.usage?.text, ...(t.usage?.accents ?? [])]) {
      if (hex != null) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("devrait refuser une diapositive qui se décompresse au-delà de 5 Mo", async () => {
    const pptx = await buildPptx({
      extra: (zip: JSZip) => zip.file("ppt/slides/slide1.xml", `<p:sld>${" ".repeat(6 * 1024 * 1024)}</p:sld>`),
    });
    await expect(extractOfficeTheme(pptx, "pptx")).rejects.toThrow(/volumineux/);
  });
});

describe("brandFromTheme — thème Office par défaut", () => {
  it("devrait proposer la charte des diapositives (cas Keolis) : accent FBE216, texte foncé, Arial", async () => {
    const { brand, notes } = brandFromTheme(await extractOfficeTheme(await buildKeolisLike(), "pptx"));
    expect(brand.colors.accent).toBe("#FBE216");
    expect(["#111111", "#222222"]).toContain(brand.colors.text);
    expect(brand.colors.background).toBe("#FFFFFF");
    expect(brand.colors.primary).toBe("#111111");
    expect(brand.fonts).toEqual({ heading: "Arial", body: "Arial" });
    expect(Object.values(brand.colors)).not.toContain("#4472C4");
    expect(Object.values(brand.colors)).not.toContain("#ED7D31");
    expect(contrastRatio(brand.colors.text, brand.colors.background)).toBeGreaterThanOrEqual(4.5);
    // La secondaire sert aux sous-titres sur le fond : un second jaune (F2C811) serait illisible.
    expect(brand.colors.secondary).not.toBe("#F2C811");
    expect(contrastRatio(brand.colors.secondary, brand.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(notes.join(" ")).toMatch(/thème Office par défaut/);
    expect(notes.join(" ")).toMatch(/diapositives/);
  });

  it("devrait garder le thème et avertir quand les diapos n'ont aucune couleur explicite", async () => {
    const { brand, notes } = brandFromTheme(await extractOfficeTheme(await buildDefaultOnly(), "pptx"));
    expect(brand.colors.primary).toBe("#4472C4");
    expect(brand.colors.secondary).toBe("#ED7D31");
    expect(notes).toContain("Le fichier n'utilise que le thème Office par défaut : vérifiez les couleurs.");
  });

  it("devrait garder un thème personnalisé même si les diapos posent d'autres couleurs", async () => {
    const pptx = await buildPptx({
      colors: { accent1: "0F4C81", accent2: "E94560", accent3: "16C79A" },
      major: "Georgia",
      minor: "Lato",
      extra: (zip: JSZip) => zip.file("ppt/slides/slide1.xml", slideXml("FFFFFF", rect(yellow))),
    });
    const { brand, notes } = brandFromTheme(await extractOfficeTheme(pptx, "pptx"));
    expect(brand.colors.primary).toBe("#0F4C81");
    expect(brand.colors.accent).toBe("#16C79A");
    expect(notes.join(" ")).not.toMatch(/thème Office par défaut/);
  });

  it("devrait corriger un contraste texte/fond insuffisant venu des diapositives", async () => {
    const pptx = await buildPptx({
      name: "Office Theme",
      extra: (zip: JSZip) =>
        zip.file("ppt/slides/slide1.xml", slideXml("111111", textShape(run("Texte presque invisible", "222222")) + rect(yellow))),
    });
    const { brand, notes } = brandFromTheme(await extractOfficeTheme(pptx, "pptx"));
    expect(brand.colors.background).toBe("#111111");
    expect(contrastRatio(brand.colors.text, brand.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(notes.join(" ")).toMatch(/[Cc]ontraste/);
  });
});

describe("detectOfficeDefault", () => {
  const theme = (accents: string[], dk2 = "#44546A") =>
    Object.fromEntries([["dk2", dk2], ...accents.map((c, i) => [`accent${i + 1}`, c])]) as Record<string, string>;

  it.each([
    ["Office 2013-2022", ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"]],
    ["Office 2013", ["#5B9BD5", "#ED7D31", "#A5A5A5", "#FFC000", "#4472C4", "#70AD47"]],
    ["Office 2007-2010", ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646"]],
    ["Office 2023+", ["#156082", "#E97132", "#196B24", "#0F9ED5", "#A02B93", "#4EA72E"]],
  ])("devrait reconnaître la palette %s", (_label, accents) => {
    expect(detectOfficeDefault(theme(accents), { major: "x", minor: "y" }).colors).toBe(true);
  });

  it("ne devrait pas reconnaître une palette modifiée", () => {
    expect(detectOfficeDefault(theme(["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#123456"]), { major: null, minor: null }).colors).toBe(false);
  });

  it.each([
    ["Calibri Light", "Calibri", true],
    ["Cambria", "Calibri", true],
    ["Aptos Display", "Aptos", true],
    ["Georgia", "Calibri", false],
  ])("polices %s / %s → défaut %s", (major, minor, expected) => {
    expect(detectOfficeDefault({}, { major, minor }).fonts).toBe(expected);
  });
});
