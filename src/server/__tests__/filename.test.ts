import { describe, expect, it } from "vitest";
import { attachmentHeader, deckFileTitle, safeFilename, unicodeFilename } from "@/server/filename";

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

describe("deckFileTitle — une seule règle pour tous les moteurs", () => {
  const createdAt = new Date("2026-10-02T09:30:00Z");

  it.each([
    [{ themeName: "Green IT", kind: "FINAL", engine: "free", createdAt }, "Green IT - deck final - Gratuit - 2026-10-02"],
    [{ themeName: "Green IT", kind: "FINAL", engine: "ollama", createdAt }, "Green IT - deck final - Ollama - 2026-10-02"],
    [{ themeName: "Énergie et société", kind: "SKELETON", engine: "claude", createdAt }, "Énergie et société - squelette - Claude"],
    [{ themeName: "Green IT", kind: "FINAL", engine: null, createdAt }, "Green IT - deck final - 2026-10-02"],
    [{ themeName: null, kind: "FINAL", engine: "claude", createdAt }, "deck final - Claude - 2026-10-02"],
    [{ themeName: "   ", kind: "FINAL", engine: "free", createdAt }, "deck final - Gratuit - 2026-10-02"],
  ] as const)("%o → %s", (info, expected) => {
    expect(deckFileTitle(info)).toBe(expected);
  });
});

describe("deckFileTitle — date du fuseau Europe/Paris", () => {
  const final = (createdAt: Date) => deckFileTitle({ themeName: "Green IT", kind: "FINAL", engine: null, createdAt });

  it("devrait dater du lendemain un deck créé à 0 h 30 à Paris (22 h 30 UTC la veille, heure d'été)", () => {
    expect(final(new Date("2026-07-14T22:30:00Z"))).toBe("Green IT - deck final - 2026-07-15");
  });

  it("devrait dater du lendemain un deck créé à 0 h 30 à Paris en hiver (23 h 30 UTC la veille)", () => {
    expect(final(new Date("2026-12-31T23:30:00Z"))).toBe("Green IT - deck final - 2027-01-01");
  });

  it("devrait garder le jour à 23 h 59 à Paris", () => {
    expect(final(new Date("2026-07-15T21:59:00Z"))).toBe("Green IT - deck final - 2026-07-15");
  });
});

describe("unicodeFilename + attachmentHeader (RFC 6266 / 5987)", () => {
  it("devrait garder les accents et retirer les caractères interdits ou dangereux", () => {
    expect(unicodeFilename("Énergie : « quel avenir » ?", "pptx")).toBe("Énergie « quel avenir ».pptx");
    expect(unicodeFilename('a/b\\c"d\r\ne\u0000f', "pptx")).toBe("a b c d e f.pptx");
    expect(unicodeFilename("../..", "pptx")).toBe("deck.pptx");
  });

  it("devrait annoncer le nom accentué en filename* et garder un repli ASCII", () => {
    const header = attachmentHeader(safeFilename("Énergie société", "pptx"), unicodeFilename("Énergie société", "pptx"));
    expect(header).toBe(`attachment; filename="Energie societe.pptx"; filename*=UTF-8''%C3%89nergie%20soci%C3%A9t%C3%A9.pptx`);
    expect(header).not.toMatch(/[\r\n]/);
  });

  it("ne devrait pas ajouter filename* quand le nom est déjà ASCII", () => {
    expect(attachmentHeader("Deck.pptx", "Deck.pptx")).toBe('attachment; filename="Deck.pptx"');
  });
});
