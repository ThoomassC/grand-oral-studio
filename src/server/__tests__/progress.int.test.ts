import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/server/db/generated/prisma/client";
import { db } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import * as programs from "@/server/repo/programs";
import { totalSlides } from "@/domain/slides";
import { makeBrand, makeTemplate } from "@/test/fixtures";
import { createUser, setupTestDatabase } from "@/test/db";
import { seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

/** Enregistre directement une répétition (préparation, sans le domaine). */
async function rehearse(deckId: string, userId: string): Promise<void> {
  await db().rehearsal.create({ data: { deckId, userId, totalSeconds: 60, perSlide: [] }, select: { id: true } });
}

/** Rend un projet « prêt » pour `userId` : 2 diaporamas et 2 répétitions. */
async function makeReady(programId: string, userId: string): Promise<void> {
  const d1 = await seedDeck(programId, null, "FINAL");
  await seedDeck(programId, null, "FINAL");
  await rehearse(d1, userId);
  await rehearse(d1, userId);
}

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

  it("devrait refléter apparence, trame, sujets, decks finaux et répétitions (les anciens squelettes ne comptent pas)", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const [t1, t2, t3] = await seedThemes(id, [themeInput("A"), themeInput("B"), themeInput("C")]);
    await seedDeck(id, t1!, "SKELETON");
    await seedDeck(id, t2!, "SKELETON");
    const final = await seedDeck(id, t1!, "FINAL");
    await seedDeck(id, t3!, "FINAL");
    await rehearse(final, a.id);
    await rehearse(final, a.id);
    await programs.updateTemplate(a.id, id, makeTemplate());

    const { progress } = await programs.getProgram(a.id, id);
    const steps = Object.fromEntries(progress.steps.map((s) => [s.id, s]));
    const tabs = Object.fromEntries(progress.templateTabs.map((t) => [t.id, t]));
    const detail = `${totalSlides(makeTemplate())} diapos · ${makeTemplate().durationMinutes} min`;
    expect(steps.appearance).toMatchObject({ status: "done", summary: "Par défaut" });
    expect(steps.template).toMatchObject({ status: "done", summary: `${detail} · 3 sujets` });
    expect(steps.day).toMatchObject({ status: "done", summary: "2 diaporamas · 2 répétitions" });
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

  it("devrait compter les decks finaux sans sujet dans le total du programme", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    await seedDeck(id, null, "FINAL");
    await seedDeck(id, null, "FINAL");
    const { progress, finalDeckCount } = await programs.getProgram(a.id, id);
    expect(finalDeckCount).toBe(2);
    // Deux diaporamas sans répétition : pas encore prêt.
    expect(progress.steps.find((s) => s.id === "day")).toMatchObject({ status: "todo", summary: "2 diaporamas · aucune répétition" });
  });

  it("devrait marquer le jour J fait seulement avec 2 diaporamas (entraînement compris) et 2 répétitions", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const practice = await seedDeck(id, null, "FINAL");
    await db().deck.update({ where: { id: practice }, data: { practice: true }, select: { id: true } });
    await rehearse(practice, a.id);
    expect((await programs.getProgram(a.id, id)).progress.nextStep).toBe("day");
    await seedDeck(id, null, "FINAL");
    expect((await programs.getProgram(a.id, id)).progress.nextStep).toBe("day");
    await rehearse(practice, a.id);
    const { progress } = await programs.getProgram(a.id, id);
    expect(progress).toMatchObject({ nextStep: null, doneCount: 3, rehearsalCount: 2 });
  });

  it("ne devrait compter ni les répétitions d'un autre membre ni celles d'un diaporama supprimé", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const id = await seedProgram(a.id);
    await seedMember(id, b.id, "VIEWER");
    const kept = await seedDeck(id, null, "FINAL");
    const deleted = await seedDeck(id, null, "FINAL");
    await rehearse(kept, a.id);
    await rehearse(deleted, a.id);
    await rehearse(kept, b.id);
    await rehearse(kept, b.id);
    await db().deck.update({ where: { id: deleted }, data: { deletedAt: new Date() }, select: { id: true } });
    expect((await programs.getProgram(a.id, id)).progress.rehearsalCount).toBe(1);
    expect((await programs.getProgram(b.id, id)).progress.rehearsalCount).toBe(2);
  });

  it("devrait compter ensemble les decks finaux avec et sans sujet", async () => {
    const a = await createUser("a");
    const id = await seedProgram(a.id);
    const [t1] = await seedThemes(id, [themeInput("A")]);
    await seedDeck(id, t1!, "FINAL");
    await seedDeck(id, null, "FINAL");
    const { progress } = await programs.getProgram(a.id, id);
    expect(progress.steps.find((s) => s.id === "day")?.summary).toBe("2 diaporamas · aucune répétition");
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
    await seedThemes(avance, [themeInput("A")]);
    await makeReady(avance, a.id);
    await programs.updateBrand(a.id, avance, makeBrand());
    await programs.updateTemplate(a.id, avance, makeTemplate());

    const list = await programs.listPrograms(a.id);
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    expect(byId[neuf]!.progress).toEqual({ doneCount: 2, total: 3, nextStep: "day", rehearsalCount: 0 });
    expect(byId[avance]!.progress).toEqual({ doneCount: 3, total: 3, nextStep: null, rehearsalCount: 2 });
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
    expect(listA[0]!.progress).toEqual({ doneCount: 2, total: 3, nextStep: "day", rehearsalCount: 0 });
  });

  it("devrait compter les répétitions de l'utilisateur seul, hors diaporamas supprimés, projet partagé compris", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const shared = await seedProgram(a.id, "Partagé");
    await seedMember(shared, b.id, "VIEWER");
    const d1 = await seedDeck(shared, null, "FINAL");
    const d2 = await seedDeck(shared, null, "FINAL");
    const gone = await seedDeck(shared, null, "FINAL");
    await rehearse(d1, a.id);
    await rehearse(d1, b.id);
    await rehearse(d2, b.id);
    await rehearse(gone, b.id);
    await rehearse(gone, a.id);
    await db().deck.update({ where: { id: gone }, data: { deletedAt: new Date() }, select: { id: true } });

    const [forA] = await programs.listPrograms(a.id);
    const [forB] = await programs.listPrograms(b.id);
    expect(forA!.progress).toEqual({ doneCount: 2, total: 3, nextStep: "day", rehearsalCount: 1 });
    expect(forB!.progress).toEqual({ doneCount: 3, total: 3, nextStep: null, rehearsalCount: 2 });
  });

  it("devrait lire la liste en un nombre de requêtes constant (pas de N+1)", async () => {
    const a = await createUser("a");
    for (let i = 0; i < 5; i += 1) {
      const id = await seedProgram(a.id, `P${i}`);
      await seedThemes(id, [themeInput(`T${i}`)]);
      await makeReady(id, a.id);
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
      // Projets prêts sans apparence ni trame enregistrées : celles par défaut comptent, tout est fait.
      expect(list.every((p) => p.progress.doneCount === 3 && p.progress.nextStep === null && p.progress.rehearsalCount === 2)).toBe(true);
      expect(queries.length).toBeGreaterThanOrEqual(1);
      expect(queries.length).toBeLessThanOrEqual(2);
    } finally {
      await client.$disconnect();
    }
  });
});
