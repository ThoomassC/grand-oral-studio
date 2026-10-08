import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import * as questions from "@/server/repo/questions";
import * as rehearsals from "@/server/repo/rehearsals";
import { generateJuryQuestions, type JuryQuestionsGenerator } from "@/server/services/jury-questions";
import { createUser, setupTestDatabase } from "@/test/db";
import { makeConformingDeck } from "@/test/fixtures";
import { seedDeck, seedMember, seedProgram, seedThemes, themeInput } from "./helpers";

setupTestDatabase();

/**
 * Entraînement (v1.2) : répétitions chronométrées (lecteur et plus, chacun pour soi)
 * et questions du jury (préparées par un éditeur, révisées par chacun avec son
 * propre statut). Inconnu → 404, lecteur qui prépare les questions → 403.
 */

/** makeConformingDeck() compte 9 diapos. */
const SLIDE_COUNT = makeConformingDeck().slides.length;
const perSlide = (seconds: number) => Array.from({ length: SLIDE_COUNT }, () => seconds);

async function setup() {
  const users = {
    owner: await createUser("owner"),
    editor: await createUser("editor"),
    viewer: await createUser("viewer"),
    stranger: await createUser("stranger"),
  };
  const programId = await seedProgram(users.owner.id, "Projet d'entraînement");
  await seedMember(programId, users.editor.id, "EDITOR");
  await seedMember(programId, users.viewer.id, "VIEWER");
  const [themeId] = await seedThemes(programId, [themeInput("Mobilités", ["sobriété"], "La voiture représente 63 % des trajets.")]);
  const deckId = await seedDeck(programId, themeId!, "FINAL");
  return { users, programId, themeId: themeId!, deckId };
}

const ITEMS = [
  { question: "Pourquoi ce sujet ?", answer: "Parce qu'il me concerne." },
  { question: "Quelle limite ?", answer: "Le coût." },
  { question: "Quelle source ?", answer: "Insee, 2024." },
];

describe("saveRehearsal", () => {
  it("devrait enregistrer la répétition d'un lecteur et la lister pour lui seul", async () => {
    const { users, programId, deckId } = await setup();
    const saved = await rehearsals.saveRehearsal(users.viewer.id, deckId, { totalSeconds: 9 * 60, perSlide: perSlide(60) });
    expect(saved.programId).toBe(programId);
    expect(saved.rehearsal).toMatchObject({ totalSeconds: 540, perSlide: perSlide(60) });
    expect(typeof saved.rehearsal.createdAt).toBe("string");

    expect(await rehearsals.listRehearsals(users.viewer.id, deckId)).toEqual([saved.rehearsal]);
    // Chacun ses répétitions : le propriétaire ne voit pas celle du lecteur.
    expect(await rehearsals.listRehearsals(users.owner.id, deckId)).toEqual([]);
  });

  it("devrait lister les répétitions de la plus récente à la plus ancienne, dans la limite demandée", async () => {
    const { users, deckId } = await setup();
    const first = await rehearsals.saveRehearsal(users.owner.id, deckId, { totalSeconds: 100, perSlide: perSlide(10) });
    const second = await rehearsals.saveRehearsal(users.owner.id, deckId, { totalSeconds: 200, perSlide: perSlide(20) });
    const list = await rehearsals.listRehearsals(users.owner.id, deckId);
    expect(list.map((r) => r.id)).toEqual([second.rehearsal.id, first.rehearsal.id]);
    expect(await rehearsals.listRehearsals(users.owner.id, deckId, 1)).toHaveLength(1);
  });

  it("devrait refuser un inconnu (404) sans rien écrire", async () => {
    const { users, deckId } = await setup();
    await expect(
      rehearsals.saveRehearsal(users.stranger.id, deckId, { totalSeconds: 90, perSlide: perSlide(10) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await rehearsals.listRehearsals(users.stranger.id, deckId)).toEqual([]);
    expect(await db().rehearsal.count()).toBe(0);
  });

  it("devrait refuser un diaporama à la corbeille (404)", async () => {
    const { users, deckId } = await setup();
    await db().deck.update({ where: { id: deckId }, data: { deletedAt: new Date() } });
    await expect(
      rehearsals.saveRehearsal(users.owner.id, deckId, { totalSeconds: 90, perSlide: perSlide(10) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("devrait refuser un nombre de temps différent du nombre de diapos du diaporama", async () => {
    const { users, deckId } = await setup();
    const error = await rehearsals
      .saveRehearsal(users.owner.id, deckId, { totalSeconds: 100, perSlide: [10, 10, 10] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.perSlide?.join(" ")).toContain(`(${SLIDE_COUNT})`);
    expect(await db().rehearsal.count()).toBe(0);
  });

  it("devrait compter les répétitions de l'utilisateur par projet, hors diaporamas à la corbeille", async () => {
    const { users, programId, themeId, deckId } = await setup();
    const otherDeck = await seedDeck(programId, themeId, "FINAL");
    const otherProgram = await seedProgram(users.owner.id, "Autre projet");
    await rehearsals.saveRehearsal(users.owner.id, deckId, { totalSeconds: 100, perSlide: perSlide(10) });
    await rehearsals.saveRehearsal(users.owner.id, otherDeck, { totalSeconds: 100, perSlide: perSlide(10) });
    await rehearsals.saveRehearsal(users.viewer.id, deckId, { totalSeconds: 100, perSlide: perSlide(10) });

    const counts = await rehearsals.countRehearsalsByProgram(users.owner.id, [programId, otherProgram]);
    expect(counts.get(programId)).toBe(2);
    expect(counts.get(otherProgram) ?? 0).toBe(0);

    await db().deck.update({ where: { id: otherDeck }, data: { deletedAt: new Date() } });
    expect((await rehearsals.countRehearsalsByProgram(users.owner.id, [programId])).get(programId)).toBe(1);
    // Un inconnu ne compte rien sur un projet qu'il ne voit pas.
    expect((await rehearsals.countRehearsalsByProgram(users.stranger.id, [programId])).size).toBe(0);
  });
});

describe("replaceQuestions", () => {
  it("devrait remplacer les questions pour un éditeur, dans l'ordre donné", async () => {
    const { users, programId, deckId } = await setup();
    const first = await questions.replaceQuestions(users.editor.id, deckId, ITEMS);
    expect(first.programId).toBe(programId);
    expect(first.questions.map((q) => [q.question, q.status])).toEqual(ITEMS.map((i) => [i.question, null]));

    const second = await questions.replaceQuestions(users.owner.id, deckId, [ITEMS[2]!]);
    expect(second.questions.map((q) => q.question)).toEqual(["Quelle source ?"]);
    expect(await db().deckQuestion.count({ where: { deckId } })).toBe(1);
    expect(await questions.getQuestions(users.viewer.id, deckId)).toEqual(second.questions);
  });

  it("devrait refuser le lecteur (403) et l'inconnu (404) sans toucher aux questions", async () => {
    const { users, deckId } = await setup();
    await questions.replaceQuestions(users.owner.id, deckId, ITEMS);
    await expect(questions.replaceQuestions(users.viewer.id, deckId, [ITEMS[0]!])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(questions.replaceQuestions(users.stranger.id, deckId, [ITEMS[0]!])).rejects.toBeInstanceOf(NotFoundError);
    await expect(questions.getQuestions(users.stranger.id, deckId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deckQuestion.count({ where: { deckId } })).toBe(3);
  });
});

describe("setReview", () => {
  it("devrait garder un statut par utilisateur", async () => {
    const { users, deckId } = await setup();
    const { questions: list } = await questions.replaceQuestions(users.owner.id, deckId, ITEMS);
    const [q1, q2] = list;

    await questions.setReview(users.viewer.id, q1!.id, "known");
    await questions.setReview(users.viewer.id, q2!.id, "to_review");
    await questions.setReview(users.editor.id, q1!.id, "to_review");
    // Un nouveau marquage remplace le précédent.
    await questions.setReview(users.viewer.id, q2!.id, "known");

    const forViewer = await questions.getQuestions(users.viewer.id, deckId);
    expect(forViewer.map((q) => q.status)).toEqual(["known", "known", null]);
    const forEditor = await questions.getQuestions(users.editor.id, deckId);
    expect(forEditor.map((q) => q.status)).toEqual(["to_review", null, null]);
    expect((await questions.getQuestions(users.owner.id, deckId)).map((q) => q.status)).toEqual([null, null, null]);
  });

  it("devrait refuser un inconnu (404) et une question inexistante (404)", async () => {
    const { users, deckId } = await setup();
    const { questions: list } = await questions.replaceQuestions(users.owner.id, deckId, ITEMS);
    await expect(questions.setReview(users.stranger.id, list[0]!.id, "known")).rejects.toBeInstanceOf(NotFoundError);
    await expect(questions.setReview(users.viewer.id, "absente", "known")).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deckQuestionReview.count()).toBe(0);
  });
});

describe("cascades", () => {
  it("devrait effacer les statuts avec les questions remplacées", async () => {
    const { users, deckId } = await setup();
    const { questions: list } = await questions.replaceQuestions(users.owner.id, deckId, ITEMS);
    await questions.setReview(users.viewer.id, list[0]!.id, "known");
    await questions.replaceQuestions(users.owner.id, deckId, ITEMS);
    expect(await db().deckQuestionReview.count()).toBe(0);
    expect((await questions.getQuestions(users.viewer.id, deckId)).map((q) => q.status)).toEqual([null, null, null]);
  });

  it("devrait effacer questions, statuts et répétitions avec le diaporama", async () => {
    const { users, deckId } = await setup();
    const { questions: list } = await questions.replaceQuestions(users.owner.id, deckId, ITEMS);
    await questions.setReview(users.viewer.id, list[0]!.id, "known");
    await rehearsals.saveRehearsal(users.viewer.id, deckId, { totalSeconds: 100, perSlide: perSlide(10) });

    await db().deck.delete({ where: { id: deckId } });
    expect(await db().deckQuestion.count()).toBe(0);
    expect(await db().deckQuestionReview.count()).toBe(0);
    expect(await db().rehearsal.count()).toBe(0);
  });
});

describe("generateJuryQuestions (sans IA)", () => {
  it("devrait préparer les questions de repli à partir du diaporama et du sujet", async () => {
    const { users, programId, deckId } = await setup();
    const result = await generateJuryQuestions(users.editor.id, deckId);
    expect(result.programId).toBe(programId);
    expect(result.engine).toBe("free");
    expect(result.questions.length).toBeGreaterThanOrEqual(8);
    expect(result.questions.length).toBeLessThanOrEqual(10);
    // Le sujet est lu : son mot-clé chiffré par les notes devient une question.
    expect(result.questions.map((q) => q.question).join("\n")).toContain("sobriété");
    expect(await questions.getQuestions(users.viewer.id, deckId)).toEqual(result.questions);
  });

  it("devrait passer par le générateur fourni (point d'extension IA)", async () => {
    const { users, deckId } = await setup();
    const generator: JuryQuestionsGenerator = {
      engine: "mock",
      generate: async ({ spec, subject }) => ({
        questions: [{ question: `Question sur ${spec.title}`, answer: `Réponse (${subject?.name ?? "sans sujet"})` }],
      }),
    };
    const result = await generateJuryQuestions(users.owner.id, deckId, { generator });
    expect(result.engine).toBe("mock");
    expect(result.questions.map((q) => q.answer)).toEqual(["Réponse (Mobilités)"]);
  });

  it("devrait refuser le lecteur (403) et l'inconnu (404)", async () => {
    const { users, deckId } = await setup();
    await expect(generateJuryQuestions(users.viewer.id, deckId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(generateJuryQuestions(users.stranger.id, deckId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db().deckQuestion.count()).toBe(0);
  });
});
