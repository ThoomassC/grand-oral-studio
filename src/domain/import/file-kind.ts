import { ImportFileError } from "./errors";

/**
 * Type d'un fichier importé : extension ET signature (octets magiques) doivent
 * concorder. Taille maximale par type. Fonction pure.
 */

export type ImportFileKind = "pptx" | "potx" | "thmx" | "pdf" | "png" | "jpeg";
export type OfficeKind = Extract<ImportFileKind, "pptx" | "potx" | "thmx">;

const MB = 1024 * 1024;

export const IMPORT_MAX_BYTES: Record<ImportFileKind, number> = {
  pptx: 20 * MB,
  potx: 20 * MB,
  thmx: 20 * MB,
  // Limites de l'API Anthropic : 5 Mo par image ; un PDF est envoyé en base64 (+33 %).
  pdf: 10 * MB,
  png: 5 * MB,
  jpeg: 5 * MB,
};

const EXTENSIONS: Record<string, ImportFileKind> = {
  pptx: "pptx",
  potx: "potx",
  thmx: "thmx",
  pdf: "pdf",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
};

const MACRO_EXTENSIONS = new Set(["pptm", "potm", "ppsm", "ppam"]);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
}

const SIGNATURES: Record<"zip" | "pdf" | "png" | "jpeg", readonly number[]> = {
  zip: [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
};

export function hasSignature(bytes: Uint8Array, kind: keyof typeof SIGNATURES): boolean {
  return startsWith(bytes, SIGNATURES[kind]);
}

function signatureOf(kind: ImportFileKind): keyof typeof SIGNATURES {
  return kind === "pptx" || kind === "potx" || kind === "thmx" ? "zip" : kind;
}

export function isOfficeKind(kind: ImportFileKind): kind is OfficeKind {
  return kind === "pptx" || kind === "potx" || kind === "thmx";
}

export function detectImportFile(fileName: string, bytes: Uint8Array): { kind: ImportFileKind } {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim())?.[1]?.toLowerCase() ?? "";
  if (MACRO_EXTENSIONS.has(ext)) {
    throw new ImportFileError("Les fichiers avec macros (.pptm, .potm) sont refusés : enregistrez-le en .pptx ou .potx.");
  }
  const kind = EXTENSIONS[ext];
  if (!kind) {
    throw new ImportFileError("Format non pris en charge : utilisez un fichier .pptx, .potx, .thmx, .pdf, .png ou .jpg.");
  }
  if (bytes.byteLength === 0) throw new ImportFileError("Le fichier est vide.");
  const max = IMPORT_MAX_BYTES[kind];
  if (bytes.byteLength > max) {
    throw new ImportFileError(`Le fichier dépasse ${Math.round(max / MB)} Mo.`);
  }
  if (!hasSignature(bytes, signatureOf(kind))) {
    throw new ImportFileError(`Le contenu du fichier ne correspond pas à son extension (.${ext}).`);
  }
  return { kind };
}
