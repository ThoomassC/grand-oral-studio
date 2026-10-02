import { describe, expect, it } from "vitest";
import { detectImportFile } from "@/domain/import/file-kind";
import { ImportFileError } from "@/domain/import/errors";
import { FAKE_PDF, JPEG_HEADER, PNG_1PX } from "./fixtures";

const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

describe("detectImportFile — extension ET signature", () => {
  it.each([
    ["charte.pptx", ZIP, "pptx"],
    ["Modèle.POTX", ZIP, "potx"],
    ["theme.thmx", ZIP, "thmx"],
    ["guide.pdf", FAKE_PDF, "pdf"],
    ["logo.png", PNG_1PX, "png"],
    ["photo.jpg", JPEG_HEADER, "jpeg"],
    ["photo.jpeg", JPEG_HEADER, "jpeg"],
  ] as const)("%s → %s", (name, bytes, kind) => {
    expect(detectImportFile(name, bytes).kind).toBe(kind);
  });

  it.each([
    ["charte.pptm", ZIP, /macros/],
    ["modele.potm", ZIP, /macros/],
    ["doc.docx", ZIP, /format non pris en charge/i],
    ["sans-extension", ZIP, /format non pris en charge/i],
    ["charte.pptx", FAKE_PDF, /ne correspond pas/],
    ["guide.pdf", PNG_1PX, /ne correspond pas/],
    ["logo.png", JPEG_HEADER, /ne correspond pas/],
    ["vide.png", new Uint8Array(0), /vide/],
  ])("devrait refuser %s", (name, bytes, message) => {
    const run = () => detectImportFile(name, bytes);
    expect(run).toThrow(ImportFileError);
    expect(run).toThrow(message);
  });

  it("devrait appliquer une taille maximale par type", () => {
    const bigPng = new Uint8Array(6 * 1024 * 1024);
    bigPng.set(PNG_1PX.subarray(0, 8));
    expect(() => detectImportFile("logo.png", bigPng)).toThrow(/5 Mo/);
  });
});
