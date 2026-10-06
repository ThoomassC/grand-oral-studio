import { describe, expect, it } from "vitest";
import { detectImportFile, RETIRED_FORMAT_MESSAGE } from "@/domain/import/file-kind";
import { ImportFileError } from "@/domain/import/errors";
import { FAKE_PDF, JPEG_HEADER, PNG_1PX } from "./fixtures";

const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

describe("detectImportFile — extension ET signature", () => {
  it.each([
    ["apparence.pptx", ZIP, "pptx"],
    ["Modèle.POTX", ZIP, "potx"],
    ["theme.thmx", ZIP, "thmx"],
  ] as const)("%s → %s", (name, bytes, kind) => {
    expect(detectImportFile(name, bytes).kind).toBe(kind);
  });

  it.each([
    ["apparence.pptm", ZIP, /macros/],
    ["modele.potm", ZIP, /macros/],
    ["doc.docx", ZIP, /format non pris en charge/i],
    ["sans-extension", ZIP, /format non pris en charge/i],
    ["apparence.pptx", FAKE_PDF, /ne correspond pas/],
    ["vide.pptx", new Uint8Array(0), /vide/],
  ])("devrait refuser %s", (name, bytes, message) => {
    const run = () => detectImportFile(name, bytes);
    expect(run).toThrow(ImportFileError);
    expect(run).toThrow(message);
  });

  it("devrait annoncer les seuls formats acceptés quand l'extension est inconnue", () => {
    expect(() => detectImportFile("doc.docx", ZIP)).toThrow(
      "Format non pris en charge : utilisez un fichier .pptx, .potx ou .thmx.",
    );
  });

  it("devrait appliquer une taille maximale de 20 Mo", () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(ZIP);
    expect(() => detectImportFile("gros.pptx", big)).toThrow(/20 Mo/);
  });
});

describe("detectImportFile — PDF et images (import retiré en 1.1.0)", () => {
  it("devrait expliquer le retrait et proposer les formats Office", () => {
    expect(RETIRED_FORMAT_MESSAGE).toBe(
      "L'import depuis un PDF ou une image n'est plus proposé : utilisez un .pptx, .potx ou .thmx d'exemple.",
    );
  });

  it.each([
    ["guide.pdf", FAKE_PDF],
    ["logo.png", PNG_1PX],
    ["photo.jpg", JPEG_HEADER],
    ["photo.JPEG", JPEG_HEADER],
    // Le message ne dépend pas du contenu : un faux PDF est refusé pour la même raison.
    ["faux.pdf", ZIP],
  ])("devrait refuser %s avec le message dédié", (name, bytes) => {
    const run = () => detectImportFile(name, bytes);
    expect(run).toThrow(ImportFileError);
    expect(run).toThrow(RETIRED_FORMAT_MESSAGE);
  });
});
