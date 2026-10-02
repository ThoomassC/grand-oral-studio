import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

export const GENERATED_DIR = path.join(__dirname, "..", ".generated");

/** Charte connue du .pptx de test (thème Office remplacé). */
export const PPTX_THEME = {
  name: "Thème E2E",
  dk1: "1A1A2E",
  lt1: "FFFFFF",
  dk2: "16213E",
  lt2: "F0F0F0",
  accent1: "C0392B",
  accent2: "27AE60",
  major: "Georgia",
  minor: "Verdana",
} as const;

export const FILES = {
  pptx: path.join(GENERATED_DIR, "charte-e2e.pptx"),
  fakePptx: path.join(GENERATED_DIR, "faux.pptx"),
  pptm: path.join(GENERATED_DIR, "macro.pptm"),
  potm: path.join(GENERATED_DIR, "macro.potm"),
  promptTxt: path.join(GENERATED_DIR, "gabarit.txt"),
  png: path.join(GENERATED_DIR, "image.png"),
};

export const SUBJECT_PROMPT =
  "Grand oral de master. Thèmes : 1. Cybersécurité 2. Transformation numérique 3. Intelligence artificielle. Couleurs : bleu marine #1F3A5F et jaune #F4AD15, police Georgia.";

export const TEMPLATE_PROMPT =
  "Oral de 20 minutes en 16:9. Sections : 1. Introduction (1 diapo) 2. Problématique (1 diapo) 3. Développement en deux parties (4 diapos) 4. Conclusion (1 diapo). Ton : professionnel.";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function themeXml(): string {
  const t = PPTX_THEME;
  const colors: Record<string, string> = {
    dk1: t.dk1,
    lt1: t.lt1,
    dk2: t.dk2,
    lt2: t.lt2,
    accent1: t.accent1,
    accent2: t.accent2,
    accent3: "A5A5A5",
    accent4: "FFC000",
    accent5: "5B9BD5",
    accent6: "70AD47",
  };
  const slots = Object.entries(colors)
    .map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${t.name}">` +
    `<a:themeElements><a:clrScheme name="E2E">${slots}<a:hlink><a:srgbClr val="0563C1"/></a:hlink></a:clrScheme>` +
    `<a:fontScheme name="E2E"><a:majorFont><a:latin typeface="${t.major}"/><a:ea typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${t.minor}"/><a:ea typeface=""/></a:minorFont></a:fontScheme>` +
    `</a:themeElements></a:theme>`
  );
}

async function buildPptx(macro: boolean): Promise<Buffer> {
  const p = new PptxGenJS();
  p.addSlide().addText("Diapo E2E", { x: 1, y: 1 });
  const bytes = (await p.write({ outputType: "uint8array" })) as Uint8Array;
  const zip = await JSZip.loadAsync(bytes);
  zip.file("ppt/theme/theme1.xml", themeXml());
  if (macro) zip.file("ppt/vbaProject.bin", "macro");
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

export async function generateFixtures(): Promise<void> {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(FILES.pptx, await buildPptx(false));
  fs.writeFileSync(FILES.pptm, await buildPptx(true));
  fs.writeFileSync(FILES.potm, await buildPptx(true));
  fs.writeFileSync(FILES.fakePptx, "Ceci est un simple fichier texte renommé en .pptx.\n");
  fs.writeFileSync(FILES.promptTxt, `${TEMPLATE_PROMPT}\n`);
  fs.writeFileSync(FILES.png, PNG_1PX);
}
