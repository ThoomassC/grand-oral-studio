import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/server/db/generated/prisma/client";
import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import * as programs from "@/server/repo/programs";
import { totalSlides } from "@/domain/slides";
import { makeBrand, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

async function savedAt(programId: string) {
  return db().program.findUniqueOrThrow({ where: { id: programId }, select: { brandSavedAt: true, templateSavedAt: true } });
}

describe("dates d'enregistrement de l'apparence et de la trame", () => {
  it("devrait laisser les deux dates à null à la création", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    expect(await savedAt(id)).toEqual({ brandSavedAt: null, templateSavedAt: null });
  });

  it("updateBrand devrait renseigner brandSavedAt (et seulement elle)", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const before = Date.now();
    await programs.updateBrand(a.id, id, makeBrand());
    const s = await savedAt(id);
    expect(s.templateSavedAt).toBeNull();
    expect(s.brandSavedAt).toBeInstanceOf(Date);
    expect(s.brandSavedAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });

  it("updateTemplate devrait renseigner templateSavedAt (et seulement elle)", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    await programs.updateTemplate(a.id, id, makeTemplate());
    const s = await savedAt(id);
    expect(s.brandSavedAt).toBeNull();
    expect(s.templateSavedAt).toBeInstanceOf(Date);
  });

  it("ne devrait rien renseigner quand B tente d'enregistrer la charte de A", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const id = await seedProgram(a.id);
    await expect(programs.updateBrand(b.id, id, makeBrand())).rejects.toBeInstanceOf(NotFoundError);
    await expect(programs.updateTemplate(b.id, id, makeTemplate())).rejects.toBeInstanceOf(NotFoundError);
    expect(await savedAt(id)).toEqual({ brandSavedAt: null, templateSavedAt: null });
  });

  it("la duplication devrait copier les deux dates", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    await programs.updateBrand(a.id, id, makeBrand());
    await programs.updateTemplate(a.id, id, makeTemplate());
    const source = await savedAt(id);
    const { id: copyId } = await programs.duplicateProgram(a.id, id);
    expect(await savedAt(copyId)).toEqual(source);
  });

  it("la duplication d'un projet jamais personnalisé devrait garder des dates nulles", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const { id: copyId } = await programs.duplicateProgram(a.id, id);
    expect(await savedAt(copyId)).toEqual({ brandSavedAt: null, templateSavedAt: null });
  });
});

describe("getProgram — progression", () => {
  it("devrait marquer apparence et trame par défaut faites et seul le jour J à faire pour un projet neuf, sans blocage", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const { progress } = await programs.getProgram(a.id, id);
    expect(progress).toMatchObject({ doneCount: 2, total: 3, nextStep: "day" });
    expect(progress.steps.map((s) => [s.id, s.status])).toEqual([
      ["appearance", "done"],
      ["template", "done"],
      ["day", "todo"],
    ]);
    for (const s of progress.steps) expect(s).not.toHaveProperty("blockedBy");
    expect(progress.templateTabs.map((t) => t.status)).toEqual(["default", "optional"]);
  });

  it("devrait refléter apparence, trame, sujets et decks finaux (les anciens squelettes ne comptent pas)", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const [t1, t2, t3] = await seedThemes(id, [themeInput("A"), themeInput("B"), themeInput("C")]);
    await seedDeck(id, t1!, "SKELETON");
    await seedDeck(id, t2!, "SKELETON");
    await seedDeck(id, t1!, "FINAL");
    await seedDeck(id, t3!, "FINAL");
    await programs.updateTemplate(a.id, id, makeTemplate());

    const { progress } = await programs.getProgram(a.id, id);
    const steps = Object.fromEntries(progress.steps.map((s) => [s.id, s]));
    const tabs = Object.fromEntries(progress.templateTabs.map((t) => [t.id, t]));
    const detail = `${totalSlides(makeTemplate())} diapos · ${makeTemplate().durationMinutes} min`;
    expect(steps.appearance).toMatchObject({ status: "done", summary: "Par défaut" });
    expect(steps.template).toMatchObject({ status: "done", summary: `${detail} · 3 sujets` });
    expect(steps.day).toMatchObject({ status: "done", summary: "2 diaporamas" });
    expect(tabs.slides).toMatchObject({ status: "done", summary: detail });
    expect(tabs.subjects).toMatchObject({ status: "done", summary: "3 sujets" });
    expect(progress).toMatchObject({ doneCount: 3, nextStep: null });
  });

  it("devrait annoncer la trame par défaut avec ses diapos et sa durée", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const { progress } = await programs.getProgram(a.id, id);
    expect(progress.steps.find((s) => s.id === "template")?.summary).toBe(
      `Par défaut · ${totalSlides(makeTemplate())} diapos · ${makeTemplate().durationMinutes} min`,
    );
  });

  it("devrait marquer l'apparence faite dès son enregistrement", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    await programs.updateBrand(a.id, id, makeBrand());
    const { progress } = await programs.getProgram(a.id, id);
    expect(progress.steps.find((s) => s.id === "appearance")).toMatchObject({ status: "done", summary: "Personnalisée" });
  });

  it("devrait marquer le jour J fait avec un seul deck final sans sujet (total du programme)", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    await seedDeck(id, null, "FINAL");
    await seedDeck(id, null, "FINAL");
    const { progress, finalDeckCount } = await programs.getProgram(a.id, id);
    expect(finalDeckCount).toBe(2);
    expect(progress.steps.find((s) => s.id === "day")).toMatchObject({ status: "done", summary: "2 diaporamas" });
  });

  it("devrait compter ensemble les decks finaux avec et sans sujet", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const [t1] = await seedThemes(id, [themeInput("A")]);
    await seedDeck(id, t1!, "FINAL");
    await seedDeck(id, null, "FINAL");
    const { progress } = await programs.getProgram(a.id, id);
    expect(progress.steps.find((s) => s.id === "day")?.summary).toBe("2 diaporamas");
  });

  it("ne devrait pas exposer le projet de A à B", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const id = await seedProgram(a.id);
    await expect(programs.getProgram(b.id, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listPrograms — progression résumée", () => {
  it("devrait exposer doneCount, total et nextStep par projet, sans les étapes", async () => {
    const a = await createUser("a");
    const neuf = await seedProgram(a.id, "Neuf");
    const avance = await seedProgram(a.id, "Avancé");
    const [t1] = await seedThemes(avance, [themeInput("A")]);
    await seedDeck(avance, t1!, "FINAL");
    await programs.updateBrand(a.id, avance, makeBrand());
    await programs.updateTemplate(a.id, avance, makeTemplate());

    const list = await programs.listPrograms(a.id);
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    expect(byId[neuf]!.progress).toEqual({ doneCount: 2, total: 3, nextStep: "day" });
    expect(byId[avance]!.progress).toEqual({ doneCount: 3, total: 3, nextStep: null });
    expect(byId[avance]!.progress).not.toHaveProperty("steps");
    expect(byId[avance]!.progress).not.toHaveProperty("templateTabs");
  });

  it("devrait compter les decks finaux par projet sans mélanger les projets ni les utilisateurs", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const pa = await seedProgram(a.id, "A");
    const pb = await seedProgram(b.id, "B");
    const [ta] = await seedThemes(pa, [themeInput("A")]);
    const [tb] = await seedThemes(pb, [themeInput("B")]);
    await seedDeck(pb, tb!, "FINAL");
    await seedDeck(pa, ta!, "SKELETON");
    await programs.updateBrand(a.id, pa, makeBrand());
    await programs.updateTemplate(a.id, pa, makeTemplate());
    const listA = await programs.listPrograms(a.id);
    expect(listA.map((p) => p.id)).toEqual([pa]);
    // A n'a pas de deck final (un ancien squelette ne compte pas) : le jour J reste à faire malgré le deck final de B.
    expect(listA[0]!.progress).toEqual({ doneCount: 2, total: 3, nextStep: "day" });
  });

  it("devrait lire la liste en un nombre de requêtes constant (pas de N+1)", async () => {
    const a = await createUser("a");
    for (let i = 0; i < 5; i += 1) {
      const id = await seedProgram(a.id, `P${i}`);
      const [t] = await seedThemes(id, [themeInput(`T${i}`)]);
      await seedDeck(id, t!, "FINAL");
    }
    const queries: string[] = [];
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, options: "-c TimeZone=UTC" }),
      log: [{ emit: "event", level: "query" }],
    });
    client.$on("query", (e) => {
      if (!/^(BEGIN|COMMIT|SELECT 1)/i.test(e.query)) queries.push(e.query);
    });
    try {
      const list = await programs.listPrograms(a.id, client);
      expect(list).toHaveLength(5);
      // Deck final sans apparence ni trame enregistrées : celles par défaut comptent, tout est fait.
      expect(list.every((p) => p.progress.doneCount === 3 && p.progress.nextStep === null)).toBe(true);
      expect(queries.length).toBeGreaterThanOrEqual(1);
      expect(queries.length).toBeLessThanOrEqual(2);
    } finally {
      await client.$disconnect();
    }
  });
});
