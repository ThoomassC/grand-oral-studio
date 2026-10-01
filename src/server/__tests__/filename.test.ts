import { describe, expect, it } from "vitest";
import { attachmentHeader, safeFilename } from "@/server/filename";

describe("safeFilename", () => {
  it("devrait translittérer les accents et retirer la ponctuation", () => {
    expect(safeFilename("Énergie : « quel avenir » ?", "pptx")).toBe("Energie quel avenir.pptx");
  });

  it.each([
    { cas: "un retour ligne (injection d'en-tête)", raw: "Deck\r\nSet-Cookie: x=1" },
    { cas: "des guillemets", raw: 'Deck"; filename="evil.exe' },
    { cas: "un chemin relatif", raw: "../../etc/passwd" },
    { cas: "un antislash", raw: "..\\windows\\system32" },
    { cas: "un caractère nul", raw: "deck\u0000.exe" },
  ])("devrait produire un nom ASCII sûr quand le titre contient $cas", ({ raw }) => {
    const name = safeFilename(raw, "pptx");
    expect(name).toMatch(/^[A-Za-z0-9 _-]+\.pptx$/);
  });

  it("devrait utiliser le nom de repli quand il ne reste rien", () => {
    expect(safeFilename("/// ??? ...", "pptx")).toBe("deck.pptx");
    expect(safeFilename("", "txt", "prompt-canva")).toBe("prompt-canva.txt");
  });

  it("devrait borner la base du nom à 80 caractères", () => {
    const name = safeFilename("a".repeat(300), "pptx");
    expect(name).toBe(`${"a".repeat(80)}.pptx`);
  });

  it("devrait assainir l'extension", () => {
    expect(safeFilename("Deck", "../PPTX")).toBe("Deck.pptx");
  });

  it("devrait produire un en-tête Content-Disposition d'une seule ligne", () => {
    const header = attachmentHeader(safeFilename('Titre "piégé"\r\nX: y', "pptx"));
    expect(header).toBe('attachment; filename="Titre piege X y.pptx"');
  });
});
