import JSZip from "jszip";
import { ImportFileError } from "./errors";
import { hasSignature } from "./file-kind";
import { attr, elements, firstInner, hexOf, NS } from "./ooxml";
import { analyzeUsage, detectOfficeDefault, type ThemeUsage } from "./office-usage";

/**
 * Thème d'une présentation Office (.pptx, .potx) ou d'un thème (.thmx) :
 * couleurs (a:clrScheme), polices (a:fontScheme) et logo du masque.
 * Si le thème est le thème Office PAR DÉFAUT (cas des fichiers produits par un
 * générateur), on lit en plus l'usage réel des couleurs et polices dans le
 * masque, les layouts et les diapositives (voir office-usage.ts).
 *
 * Sécurité (le fichier vient de l'utilisateur) :
 *  - taille du fichier ≤ 20 Mo, ≤ 2 000 entrées ;
 *  - décompression bornée PAR ENTRÉE LUE (5 Mo pour un XML, 2 Mo pour une
 *    image) : la lecture s'interrompt au-delà, quoi que prétende l'en-tête ;
 *  - aucune DTD ni entité acceptée ; XML lu par expressions ciblées (aucun
 *    parseur, aucune résolution externe) ;
 *  - macros refusées (vbaProject.bin, type de contenu macroEnabled) ;
 *  - seules quelques entrées connues sont lues ; les chemins des .rels sont
 *    résolus sans jamais sortir de l'archive ;
 *  - l'analyse d'usage n'a lieu que pour un thème par défaut, et s'arrête à
 *    300 diapositives, 100 layouts ou 40 Mo de XML décompressé au total.
 */

export const OFFICE_IMPORT_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  entries: 2_000,
  xmlBytes: 5 * 1024 * 1024,
  imageBytes: 2 * 1024 * 1024,
  logoBytes: 500 * 1024,
  usageSlides: 300,
  usageLayouts: 100,
  usageXmlBytes: 40 * 1024 * 1024,
} as const;

export const THEME_COLOR_SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;
export type ThemeColorSlot = (typeof THEME_COLOR_SLOTS)[number];

export interface ExtractedTheme {
  /** Nom du thème Office (attribut name de a:theme). */
  name: string | null;
  /** Couleurs au format #RRGGBB (majuscules). */
  colors: Partial<Record<ThemeColorSlot, string>>;
  fonts: { major: string | null; minor: string | null };
  /** Logo PNG/JPEG du masque (≤ 500 Ko), en data URL. */
  logoDataUrl: string | null;
  /** Remarques affichables (logo ignoré…). */
  notes: string[];
  /** Couleurs / polices du thème identiques à un thème Office livré par Microsoft. */
  officeDefault?: { colors: boolean; fonts: boolean };
  /** Usage réel dans les diapositives ; lu seulement quand le thème est un thème par défaut. */
  usage?: ThemeUsage | null;
}

declare module "jszip" {
  interface JSZipObject {
    /** API documentée de JSZip (non déclarée dans ses types) : lecture en flux, interruptible. */
    internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
  }
}

const MASTER_PART = "ppt/slideMasters/slideMaster1.xml";

class EntryTooLargeError extends ImportFileError {
  constructor() {
    super("Le fichier contient un élément trop volumineux : import refusé.");
  }
}

/** Lit une entrée en s'arrêtant dès que `maxBytes` octets décompressés sont dépassés. */
function readBounded(file: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    const stream = file.internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        if (done) return;
        total += chunk.byteLength;
        if (total > maxBytes) {
          done = true;
          stream.pause();
          reject(new EntryTooLargeError());
          return;
        }
        chunks.push(chunk);
      })
      .on("error", () => {
        if (done) return;
        done = true;
        reject(new ImportFileError("Le fichier est endommagé : impossible de le lire."));
      })
      .on("end", () => {
        if (done) return;
        done = true;
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.byteLength;
        }
        resolve(out);
      })
      .resume();
  });
}

const decoder = new TextDecoder("utf-8", { fatal: false });

async function readXml(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  const xml = decoder.decode(await readBounded(file, OFFICE_IMPORT_LIMITS.xmlBytes));
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new ImportFileError("Le fichier contient des déclarations XML non autorisées : import refusé.");
  }
  return xml;
}

function parseTheme(xml: string): Omit<ExtractedTheme, "logoDataUrl" | "notes"> {
  const themeTag = new RegExp(`<${NS}theme\\b[^<>]*>`).exec(xml)?.[0] ?? "";
  const name = attr(themeTag, "name")?.trim() || null;

  // firstInner : parcours linéaire, même sur un thème piégé (ouvrantes sans fermante).
  const scheme = firstInner(xml, "clrScheme") ?? "";
  const colors: Partial<Record<ThemeColorSlot, string>> = {};
  for (const slot of THEME_COLOR_SLOTS) {
    const inner = firstInner(scheme, slot) ?? "";
    const srgb = new RegExp(`<${NS}srgbClr\\b[^<>]*>`).exec(inner)?.[0];
    const sys = new RegExp(`<${NS}sysClr\\b[^<>]*>`).exec(inner)?.[0];
    const hex = srgb ? hexOf(attr(srgb, "val")) : sys ? hexOf(attr(sys, "lastClr")) : null;
    if (hex) colors[slot] = hex;
  }

  const font = (kind: "majorFont" | "minorFont"): string | null => {
    const block = firstInner(xml, kind) ?? "";
    const latin = new RegExp(`<${NS}latin\\b[^<>]*>`).exec(block)?.[0];
    return (latin && attr(latin, "typeface")?.trim()) || null;
  };
  return { name, colors, fonts: { major: font("majorFont"), minor: font("minorFont") } };
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

function parseRels(xml: string | null): Relationship[] {
  if (!xml) return [];
  const out: Relationship[] = [];
  for (const m of xml.matchAll(/<Relationship\b[^<>]*>/g)) {
    const tag = m[0];
    if (attr(tag, "TargetMode") === "External") continue;
    const id = attr(tag, "Id");
    const type = attr(tag, "Type");
    const target = attr(tag, "Target");
    if (id && type && target) out.push({ id, type, target });
  }
  return out;
}

/** Chemin cible d'une relation, relatif au dossier de la partie source ; null s'il sort de l'archive. */
function resolvePart(sourcePart: string, target: string): string | null {
  const segments = target.startsWith("/") ? [] : sourcePart.split("/").slice(0, -1);
  for (const seg of target.replace(/^\/+/, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(seg);
  }
  return segments.join("/");
}

function relsPathOf(part: string): string {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

async function findThemePart(zip: JSZip): Promise<{ themePart: string | null; masterRels: Relationship[] }> {
  const master = MASTER_PART;
  const masterRels = parseRels(await readXml(zip, relsPathOf(master)));
  const rel = masterRels.find((r) => r.type.endsWith("/theme"));
  const linked = rel ? resolvePart(master, rel.target) : null;
  if (linked && zip.file(linked)) return { themePart: linked, masterRels };
  const themes = Object.keys(zip.files)
    .filter((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  return { themePart: themes[0] ?? null, masterRels };
}

/** Première image (p:pic → a:blip r:embed) d'une partie, si c'est un PNG ou un JPEG. */
async function firstPicture(zip: JSZip, part: string, rels: Relationship[], notes: string[]): Promise<string | null> {
  const xml = await readXml(zip, part);
  if (!xml) return null;
  // Parcours linéaire (pas de `[\s\S]*?` rejoué à chaque <p:pic> d'un XML piégé).
  let rid: string | null = null;
  for (const pic of elements(xml, "pic")) {
    const blip = new RegExp(`<${NS}blip\\b[^<>]*>`).exec(pic.inner ?? "")?.[0];
    rid = blip ? attr(blip, "r:embed") : null;
    if (rid) break;
  }
  if (!rid) return null;
  const rel = rels.find((r) => r.id === rid && r.type.endsWith("/image"));
  const path = rel ? resolvePart(part, rel.target) : null;
  const file = path ? zip.file(path) : null;
  if (!file) return null;

  let bytes: Uint8Array;
  try {
    bytes = await readBounded(file, OFFICE_IMPORT_LIMITS.imageBytes);
  } catch (error) {
    if (error instanceof EntryTooLargeError) {
      notes.push("Logo ignoré : plus de 500 Ko.");
      return null;
    }
    throw error;
  }
  const mime = hasSignature(bytes, "png") ? "image/png" : hasSignature(bytes, "jpeg") ? "image/jpeg" : null;
  if (!mime) return null;
  if (bytes.byteLength > OFFICE_IMPORT_LIMITS.logoBytes) {
    notes.push("Logo ignoré : plus de 500 Ko.");
    return null;
  }
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function findLogo(zip: JSZip, masterRels: Relationship[], notes: string[]): Promise<string | null> {
  const master = MASTER_PART;
  const fromMaster = await firstPicture(zip, master, masterRels, notes);
  if (fromMaster || notes.length > 0) return fromMaster;
  const layoutRel = masterRels.find((r) => r.type.endsWith("/slideLayout"));
  const layout = layoutRel ? resolvePart(master, layoutRel.target) : null;
  if (!layout) return null;
  const layoutRels = parseRels(await readXml(zip, relsPathOf(layout)));
  return firstPicture(zip, layout, layoutRels, notes);
}

const DEFAULT_SLIDE_AREA = 12_192_000 * 6_858_000;

/** Lit masque, layouts et diapositives dans un budget global de XML décompressé. */
async function readUsage(
  zip: JSZip,
  masterRels: Relationship[],
  theme: Pick<ExtractedTheme, "colors" | "fonts">,
  notes: string[],
): Promise<ThemeUsage> {
  let budget: number = OFFICE_IMPORT_LIMITS.usageXmlBytes;
  let truncated = false;
  const read = async (part: string): Promise<string | null> => {
    if (budget <= 0) {
      truncated = true;
      return null;
    }
    const xml = await readXml(zip, part);
    if (xml) budget -= xml.length;
    return xml;
  };

  const sldSz = new RegExp(`<${NS}sldSz\\b[^<>]*>`).exec((await read("ppt/presentation.xml")) ?? "")?.[0];
  const cx = Number(sldSz ? attr(sldSz, "cx") : NaN);
  const cy = Number(sldSz ? attr(sldSz, "cy") : NaN);
  const slideArea = cx > 0 && cy > 0 ? cx * cy : DEFAULT_SLIDE_AREA;
  const masterXml = await read(MASTER_PART);
  const layouts = new Map<string, string>();
  for (const rel of masterRels.filter((r) => r.type.endsWith("/slideLayout")).slice(0, OFFICE_IMPORT_LIMITS.usageLayouts)) {
    const part = resolvePart(MASTER_PART, rel.target);
    if (!part || layouts.has(part)) continue;
    const xml = await read(part);
    if (xml) layouts.set(part, xml);
  }

  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  if (slidePaths.length > OFFICE_IMPORT_LIMITS.usageSlides) truncated = true;
  const slides: { xml: string; layoutPart: string | null }[] = [];
  for (const path of slidePaths.slice(0, OFFICE_IMPORT_LIMITS.usageSlides)) {
    const xml = await read(path);
    if (!xml) break;
    const layoutRel = parseRels(await read(relsPathOf(path))).find((r) => r.type.endsWith("/slideLayout"));
    slides.push({ xml, layoutPart: layoutRel ? resolvePart(path, layoutRel.target) : null });
  }
  if (truncated) notes.push(`Couleurs analysées sur les ${slides.length} premières diapositives seulement.`);

  return analyzeUsage({ theme: { colors: theme.colors, fonts: theme.fonts }, masterXml, layouts, slides, slideArea });
}

export async function extractOfficeTheme(bytes: Uint8Array, kind: "pptx" | "potx" | "thmx"): Promise<ExtractedTheme> {
  if (bytes.byteLength > OFFICE_IMPORT_LIMITS.fileBytes) throw new ImportFileError("Le fichier dépasse 20 Mo.");
  if (!hasSignature(bytes, "zip")) throw new ImportFileError("Ce fichier n'est pas une présentation ou un thème Office valide.");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch {
    throw new ImportFileError("Ce fichier n'est pas une présentation ou un thème Office valide.");
  }
  const names = Object.keys(zip.files);
  if (names.length > OFFICE_IMPORT_LIMITS.entries) {
    throw new ImportFileError("L'archive contient trop d'entrées (plus de 2 000) : import refusé.");
  }
  const contentTypes = await readXml(zip, "[Content_Types].xml");
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n)) || (contentTypes && /macroEnabled/i.test(contentTypes))) {
    throw new ImportFileError("Les fichiers avec macros sont refusés : enregistrez-le en .pptx ou .potx.");
  }

  const notes: string[] = [];
  let themePart: string | null;
  let masterRels: Relationship[] = [];
  if (kind === "thmx") {
    themePart = zip.file("theme/theme/theme1.xml") ? "theme/theme/theme1.xml" : null;
  } else {
    ({ themePart, masterRels } = await findThemePart(zip));
  }
  const themeXml = themePart ? await readXml(zip, themePart) : null;
  if (!themeXml) throw new ImportFileError("Aucun thème trouvé dans ce fichier.");

  const theme = parseTheme(themeXml);
  const logoDataUrl = kind === "thmx" ? null : await findLogo(zip, masterRels, notes);
  const officeDefault = detectOfficeDefault(theme.colors, theme.fonts);
  // Ne lit les diapositives que si le thème ne dit rien de la charte.
  const usage =
    kind !== "thmx" && (officeDefault.colors || officeDefault.fonts) ? await readUsage(zip, masterRels, theme, notes) : null;
  return { ...theme, logoDataUrl, notes, officeDefault, usage };
}
