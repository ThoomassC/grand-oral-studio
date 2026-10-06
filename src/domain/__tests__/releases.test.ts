import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASES, RELEASE_SECTION_LABELS, RELEASE_SECTION_ORDER, type ReleaseSection } from "@/domain/releases";

/** Source unique des notes de version : invariants que la page et CHANGELOG.md supposent. */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function semver(version: string): [number, number, number] {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Version non semver : ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: string, b: string): number {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

describe("RELEASES", () => {
  it("devrait lister des versions semver, de la plus récente à la plus ancienne, sans doublon", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    for (const release of RELEASES) expect(release.version).toMatch(SEMVER);
    for (let i = 1; i < RELEASES.length; i += 1) {
      expect(compare(RELEASES[i - 1]!.version, RELEASES[i]!.version), `${RELEASES[i - 1]!.version} > ${RELEASES[i]!.version}`).toBeGreaterThan(0);
    }
  });

  it("devrait commencer par la version de package.json", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(RELEASES[0]!.version).toBe(pkg.version);
  });

  it("ne devrait laisser « à venir » (date null) qu'à la première version", () => {
    RELEASES.slice(1).forEach((release) => expect(release.date, release.version).not.toBeNull());
  });

  it("devrait dater chaque version publiée d'une date ISO réelle", () => {
    for (const release of RELEASES) {
      if (release.date === null) continue;
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Une date impossible (« 2026-02-30 ») ne survit pas à l'aller-retour.
      expect(new Date(`${release.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(release.date);
    }
  });

  it("devrait dater les versions dans l'ordre (jamais une plus récente avant une plus ancienne)", () => {
    const dates = RELEASES.map((r) => r.date).filter((d): d is string => d !== null);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("devrait résumer chaque version en une phrase, sans groupe déclaré vide ni entrée vide", () => {
    for (const release of RELEASES) {
      expect(release.summary.trim(), release.version).not.toBe("");
      for (const [section, items] of Object.entries(release.changes)) {
        expect(items, `${release.version} / ${section}`).not.toHaveLength(0);
        for (const item of items ?? []) expect(item.trim(), `${release.version} / ${section}`).not.toBe("");
      }
    }
  });

  it("devrait n'employer que des groupes connus", () => {
    for (const release of RELEASES) {
      for (const section of Object.keys(release.changes)) expect(RELEASE_SECTION_ORDER).toContain(section);
    }
  });
});

describe("RELEASE_SECTION_ORDER", () => {
  it("devrait couvrir chaque groupe une seule fois, avec son libellé", () => {
    const keys = Object.keys(RELEASE_SECTION_LABELS) as ReleaseSection[];
    expect([...RELEASE_SECTION_ORDER].sort()).toEqual([...keys].sort());
    expect(new Set(RELEASE_SECTION_ORDER).size).toBe(RELEASE_SECTION_ORDER.length);
    expect(RELEASE_SECTION_ORDER.map((s) => RELEASE_SECTION_LABELS[s])).toEqual(["Ajouts", "Modifications", "Retraits", "Corrections"]);
  });
});
