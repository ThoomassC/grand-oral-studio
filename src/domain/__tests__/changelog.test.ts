import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatReleaseDate, renderChangelog } from "@/domain/changelog";
import { RELEASES, type Release } from "@/domain/releases";

/**
 * CHANGELOG.md est généré depuis src/domain/releases.ts. Lancé avec
 * CHANGELOG_WRITE=1 (`npm run changelog`), ce fichier de test le réécrit ;
 * sinon il vérifie que la version commitée est à jour.
 */

const CHANGELOG_PATH = path.resolve(process.cwd(), "CHANGELOG.md");

describe("formatReleaseDate", () => {
  it("devrait écrire la date en toutes lettres, sans zéro initial", () => {
    expect(formatReleaseDate("2026-10-04")).toBe("4 octobre 2026");
    expect(formatReleaseDate("2027-01-31")).toBe("31 janvier 2027");
    expect(formatReleaseDate("2026-08-01")).toBe("1er août 2026");
  });

  it("devrait dire « à venir » pour une version non publiée", () => {
    expect(formatReleaseDate(null)).toBe("à venir");
  });

  it("devrait refuser une date mal formée", () => {
    expect(() => formatReleaseDate("4 octobre 2026")).toThrow();
    expect(() => formatReleaseDate("2026-13-01")).toThrow();
  });
});

describe("renderChangelog", () => {
  const releases: Release[] = [
    {
      version: "2.0.0",
      date: null,
      summary: "Une version à venir.",
      changes: { removed: ["Un retrait."], added: ["Un ajout.", "Un second ajout."] },
    },
    { version: "1.0.1", date: "2026-10-04", summary: "Rien ne change.", changes: {} },
  ];

  it("devrait produire le Markdown exact : groupes dans l'ordre, groupes vides omis, fin de ligne finale", () => {
    expect(renderChangelog(releases)).toBe(
      [
        "# Notes de version",
        "",
        "<!-- Généré par `npm run changelog` depuis src/domain/releases.ts : ne pas modifier à la main. -->",
        "",
        "## 2.0.0 — à venir",
        "",
        "Une version à venir.",
        "",
        "### Ajouts",
        "",
        "- Un ajout.",
        "- Un second ajout.",
        "",
        "### Retraits",
        "",
        "- Un retrait.",
        "",
        "## 1.0.1 — 4 octobre 2026",
        "",
        "Rien ne change.",
        "",
      ].join("\n"),
    );
  });

  it("ne devrait laisser ni espace en fin de ligne ni ligne vide double", () => {
    const md = renderChangelog(RELEASES);
    expect(md).not.toMatch(/[ \t]+$/m);
    expect(md).not.toMatch(/\n\n\n/);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("CHANGELOG.md", () => {
  it("devrait être à jour avec src/domain/releases.ts", () => {
    const expected = renderChangelog(RELEASES);
    if (process.env.CHANGELOG_WRITE === "1") writeFileSync(CHANGELOG_PATH, expected);
    expect(readFileSync(CHANGELOG_PATH, "utf8"), "CHANGELOG.md n'est pas à jour : lancez npm run changelog.").toBe(expected);
  });
});
