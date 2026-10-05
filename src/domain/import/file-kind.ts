import { ImportFileError } from "./errors";

/**
 * Type d'un fichier importé (apparence d'exemple) : extension ET signature
 * (octets magiques) doivent concorder. Seuls les fichiers Office sont lus, sans
 * IA. Fonction pure, utilisable côté client comme côté serveur.
 */

export type ImportFileKind = "pptx" | "potx" | "thmx";

const MB = 1024 * 1024;

/** Taille maximale d'un fichier Office importé. */
export const IMPORT_MAX_BYTES = 20 * MB;

/**
 * Import d'apparence depuis un PDF ou une image : retiré en 1.1.0 (il exigeait
 * l'IA avant le jour J). Message affiché tel quel, côté client et côté serveur.
 */
export const RETIRED_FORMAT_MESSAGE =
  "L'import depuis un PDF ou une image n'est plus proposé : utilisez un .pptx, .potx ou .thmx d'exemple.";

const EXTENSIONS: Record<string, ImportFileKind> = {
  pptx: "pptx",
  potx: "potx",
  thmx: "thmx",
};

/** Extensions des formats retirés : refusées avec une explication plutôt qu'un « format non pris en charge ». */
export const RETIRED_EXTENSIONS: readonly string[] = ["pdf", "png", "jpg", "jpeg"];

const MACRO_EXTENSIONS = new Set(["pptm", "potm", "ppsm", "ppam"]);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
}

/** Signatures utiles : l'archive Office, et les images du logo qu'elle peut contenir. */
const SIGNATURES: Record<"zip" | "png" | "jpeg", readonly number[]> = {
  zip: [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
};

export function hasSignature(bytes: Uint8Array, kind: keyof typeof SIGNATURES): boolean {
  return startsWith(bytes, SIGNATURES[kind]);
}

/** Extension en minuscules (« .POTX » → « potx »), "" si absente. */
export function fileExtension(fileName: string): string {
  return /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim())?.[1]?.toLowerCase() ?? "";
}

export function detectImportFile(fileName: string, bytes: Uint8Array): { kind: ImportFileKind } {
  const ext = fileExtension(fileName);
  if (MACRO_EXTENSIONS.has(ext)) {
    throw new ImportFileError("Les fichiers avec macros (.pptm, .potm) sont refusés : enregistrez-le en .pptx ou .potx.");
  }
  if (RETIRED_EXTENSIONS.includes(ext)) throw new ImportFileError(RETIRED_FORMAT_MESSAGE);
  const kind = EXTENSIONS[ext];
  if (!kind) {
    throw new ImportFileError("Format non pris en charge : utilisez un fichier .pptx, .potx ou .thmx.");
  }
  if (bytes.byteLength === 0) throw new ImportFileError("Le fichier est vide.");
  if (bytes.byteLength > IMPORT_MAX_BYTES) {
    throw new ImportFileError(`Le fichier dépasse ${IMPORT_MAX_BYTES / MB} Mo.`);
  }
  if (!hasSignature(bytes, "zip")) {
    throw new ImportFileError(`Le contenu du fichier ne correspond pas à son extension (.${ext}).`);
  }
  return { kind };
}
