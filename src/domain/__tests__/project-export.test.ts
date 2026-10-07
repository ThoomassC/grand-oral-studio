import { describe, expect, it } from "vitest";
import {
  buildProjectExport,
  parseProjectExport,
  PROJECT_EXPORT_FORMAT,
  PROJECT_EXPORT_VERSION,
  PROJECT_FILE_MAX_BYTES,
  serializeProjectExport,
  type ExportedProject,
} from "@/domain/project-export";
import { BRAND_FILE_MAX_BYTES } from "@/domain/import/limits";
import { makeBrand, makeConformingDeck, makeTemplate } from "@/test/fixtures";

function project(overrides: Partial<ExportedProject> = {}): ExportedProject {
  return {
    name: "Grand oral d'essai",
    description: "Projet de test",
    brand: makeBrand(),
    template: makeTemplate(),
    themes: [
      {
        name: "Transition énergétique",
        description: "Énergie et climat",
        keywords: ["énergie", "climat"],
        notes: "Chiffre clé : 42 %.",
        problems: ["Comment financer la transition énergétique ?"],
      },
      { name: "Ville de demain", description: "", keywords: [], notes: "", problems: [] },
    ],
    decks: [
      {
        themeName: "Transition énergétique",
        practice: true,
        problem: "Comment financer la transition énergétique ?",
        spec: makeConformingDeck(),
        engine: "free",
        createdAt: "2026-10-01T08:00:00.000Z",
      },
      {
        themeName: null,
        practice: false,
        problem: "Une problématique sans sujet rattaché",
        spec: makeConformingDeck(),
        engine: null,
        createdAt: "2026-10-02T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

const NOW = new Date("2026-10-07T10:00:00.000Z");

describe("buildProjectExport / parseProjectExport", () => {
  it("devrait relire à l'identique un export sérialisé (aller-retour)", () => {
    const exported = buildProjectExport(project(), NOW);
    expect(exported.format).toBe(PROJECT_EXPORT_FORMAT);
    expect(exported.version).toBe(PROJECT_EXPORT_VERSION);
    expect(exported.exportedAt).toBe(NOW.toISOString());

    const parsed = parseProjectExport(serializeProjectExport(exported));
    expect(parsed).toEqual({ ok: true, project: project() });
  });

  it("devrait refuser une version de format inconnue", () => {
    const text = JSON.stringify({ ...buildProjectExport(project(), NOW), version: 2 });
    const parsed = parseProjectExport(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/version plus récente/);
  });

  it("devrait refuser un fichier d'un autre format", () => {
    const parsed = parseProjectExport(JSON.stringify({ format: "autre-chose", version: 1, project: project() }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/n'est pas un export de projet/);
  });

  it("devrait refuser un texte qui n'est pas du JSON", () => {
    const parsed = parseProjectExport("pas du json {");
    expect(parsed.ok).toBe(false);
  });

  it("devrait refuser un fichier qui dépasse la taille maximale, sans le lire", () => {
    expect(PROJECT_FILE_MAX_BYTES).toBe(BRAND_FILE_MAX_BYTES);
    const parsed = parseProjectExport(" ".repeat(PROJECT_FILE_MAX_BYTES + 1));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/4 Mo/);
  });

  it("devrait refuser un diaporama rattaché à un sujet absent du fichier", () => {
    const bad = project({
      decks: [{ ...project().decks[0]!, themeName: "Sujet fantôme" }],
    });
    const text = JSON.stringify({ format: PROJECT_EXPORT_FORMAT, version: 1, exportedAt: NOW.toISOString(), project: bad });
    const result = parseProjectExport(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors ?? {})).toContain("project.decks.0.themeName");
  });

  it("ne devrait conserver aucun champ interne (ids, propriétaire, membres, clés) à la lecture", () => {
    const exported = buildProjectExport(project(), NOW);
    const polluted = {
      ...exported,
      ownerId: "user-1",
      members: [{ userId: "u2", role: "EDITOR" }],
      project: {
        ...exported.project,
        id: "prog-1",
        ownerId: "user-1",
        apiKey: "sk-ant-secret",
        themes: exported.project.themes.map((t) => ({ ...t, id: "theme-1", programId: "prog-1" })),
        decks: exported.project.decks.map((d) => ({ ...d, id: "deck-1", createdById: "user-1", deletedAt: null })),
      },
    };
    const parsed = parseProjectExport(JSON.stringify(polluted));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const text = JSON.stringify(parsed.project);
    for (const forbidden of ["ownerId", "members", "apiKey", "sk-ant", "programId", "createdById", "deletedAt", "prog-1", "theme-1", "deck-1"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("ne devrait produire à l'export que les champs du format", () => {
    const exported = buildProjectExport(project(), NOW);
    expect(Object.keys(exported).sort()).toEqual(["exportedAt", "format", "project", "version"]);
    expect(Object.keys(exported.project).sort()).toEqual(["brand", "decks", "description", "name", "template", "themes"]);
    expect(Object.keys(exported.project.themes[0]!).sort()).toEqual(["description", "keywords", "name", "notes", "problems"]);
    expect(Object.keys(exported.project.decks[0]!).sort()).toEqual([
      "createdAt",
      "engine",
      "practice",
      "problem",
      "spec",
      "themeName",
    ]);
  });

  it("devrait compléter les problématiques absentes d'un sujet par une liste vide", () => {
    const exported = buildProjectExport(project(), NOW);
    const raw = JSON.parse(serializeProjectExport(exported)) as { project: { themes: Record<string, unknown>[] } };
    delete raw.project.themes[1]!.problems;
    const parsed = parseProjectExport(JSON.stringify(raw));
    expect(parsed.ok && parsed.project.themes[1]!.problems).toEqual([]);
  });
});
