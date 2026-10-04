import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

/**
 * Fixtures construites à la volée : un vrai .pptx produit par pptxgenjs, dont on
 * remplace le thème (couleurs, polices, nom) et auquel on peut ajouter un logo
 * dans le masque ; un .thmx minimal zippé à la main ; des archives piégées.
 */

/** PNG 1×1 valide. */
export const PNG_1PX = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);
export const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

export interface ThemeSpec {
  name?: string;
  colors?: Partial<Record<"dk1" | "lt1" | "dk2" | "lt2" | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6", string>>;
  /** Couleurs système (a:sysClr lastClr) au lieu de srgbClr. */
  sysColors?: Partial<Record<"dk1" | "lt1", string>>;
  major?: string;
  minor?: string;
}

const DEFAULT_COLORS = {
  dk1: "000000",
  lt1: "FFFFFF",
  dk2: "44546A",
  lt2: "E7E6E6",
  accent1: "4472C4",
  accent2: "ED7D31",
  accent3: "A5A5A5",
  accent4: "FFC000",
  accent5: "5B9BD5",
  accent6: "70AD47",
};

export function themeXml(spec: ThemeSpec = {}): string {
  const colors = { ...DEFAULT_COLORS, ...spec.colors };
  const slot = (k: keyof typeof DEFAULT_COLORS) => {
    const sys = spec.sysColors?.[k as "dk1" | "lt1"];
    const inner = sys ? `<a:sysClr val="windowText" lastClr="${sys}"/>` : `<a:srgbClr val="${colors[k]}"/>`;
    return `<a:${k}>${inner}</a:${k}>`;
  };
  const slots = (Object.keys(DEFAULT_COLORS) as (keyof typeof DEFAULT_COLORS)[]).map(slot).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${spec.name ?? "Thème Essai"}">` +
    `<a:themeElements><a:clrScheme name="Essai">${slots}<a:hlink><a:srgbClr val="0563C1"/></a:hlink></a:clrScheme>` +
    `<a:fontScheme name="Essai"><a:majorFont><a:latin typeface="${spec.major ?? "Georgia"}"/><a:ea typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${spec.minor ?? "Arial"}"/><a:ea typeface=""/></a:minorFont></a:fontScheme>` +
    `</a:themeElements></a:theme>`
  );
}

async function basePptx(): Promise<JSZip> {
  const p = new PptxGenJS();
  p.addSlide().addText("Diapo", { x: 1, y: 1 });
  const bytes = (await p.write({ outputType: "uint8array" })) as Uint8Array;
  return JSZip.loadAsync(bytes);
}

export interface PptxSpec extends ThemeSpec {
  /** Logo inséré dans le masque (p:pic) ; `where: "layout"` le met dans le premier layout. */
  logo?: { bytes: Uint8Array; ext: "png" | "jpeg" | "gif"; where?: "master" | "layout" };
  /** Thème lié au masque sous un autre nom que theme1.xml (vérifie le suivi des .rels). */
  themeFile?: string;
  macro?: boolean;
  extra?: (zip: JSZip) => void;
}

const PIC = (rid: string) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="99" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
  `<p:blipFill><a:blip r:embed="${rid}"/></p:blipFill><p:spPr/></p:pic>`;

export async function buildPptx(spec: PptxSpec = {}): Promise<Uint8Array> {
  const zip = await basePptx();
  const themePath = spec.themeFile ? `ppt/theme/${spec.themeFile}` : "ppt/theme/theme1.xml";
  if (spec.themeFile) {
    // Un leurre en theme1.xml : seul le thème référencé par le masque doit être lu.
    zip.file("ppt/theme/theme1.xml", themeXml({ name: "Leurre", colors: { accent1: "111111" } }));
    const relsPath = "ppt/slideMasters/_rels/slideMaster1.xml.rels";
    const rels = await zip.file(relsPath)!.async("string");
    zip.file(relsPath, rels.replace("../theme/theme1.xml", `../theme/${spec.themeFile}`));
  }
  zip.file(themePath, themeXml(spec));

  if (spec.logo) {
    const where = spec.logo.where ?? "master";
    const xmlPath = where === "master" ? "ppt/slideMasters/slideMaster1.xml" : "ppt/slideLayouts/slideLayout1.xml";
    const relsPath = where === "master" ? "ppt/slideMasters/_rels/slideMaster1.xml.rels" : "ppt/slideLayouts/_rels/slideLayout1.xml.rels";
    const xml = await zip.file(xmlPath)!.async("string");
    zip.file(xmlPath, xml.replace("</p:spTree>", `${PIC("rIdLogo")}</p:spTree>`));
    const rels = await zip.file(relsPath)!.async("string");
    zip.file(
      relsPath,
      rels.replace(
        "</Relationships>",
        `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.${spec.logo.ext}"/></Relationships>`,
      ),
    );
    zip.file(`ppt/media/logo.${spec.logo.ext}`, spec.logo.bytes);
  }
  if (spec.macro) zip.file("ppt/vbaProject.bin", "macro");
  spec.extra?.(zip);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildThmx(spec: ThemeSpec = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file("theme/theme/theme1.xml", themeXml(spec));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Archive dont une entrée XML se décompresse bien au-delà de 5 Mo. */
export async function buildXmlBomb(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("ppt/slideMasters/slideMaster1.xml", "<p:sldMaster/>");
  zip.file("ppt/theme/theme1.xml", `<a:theme name="x">${" ".repeat(8 * 1024 * 1024)}</a:theme>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

export async function buildManyEntries(count: number): Promise<Uint8Array> {
  const zip = new JSZip();
  for (let i = 0; i < count; i += 1) zip.file(`f/${i}.txt`, "x");
  zip.file("theme/theme/theme1.xml", themeXml());
  return zip.generateAsync({ type: "uint8array" });
}

export const FAKE_PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
