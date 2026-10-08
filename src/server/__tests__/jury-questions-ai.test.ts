import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeRef } from "@/domain/contracts";
import { AiInvalidOutputError, AiUnavailableError } from "@/server/errors";
import type { AiProvider, StructuredRequest } from "@/server/ai";
import { makeConformingDeck } from "@/test/fixtures";

/**
 * Questions du jury par IA : le générateur appelle la tâche structurée
 * « juryQuestions », sa sortie est revalidée par le service, et une erreur IA
 * remonte telle quelle — jamais de bascule silencieuse vers la version sans IA.
 */

const repo = { getQuestionContext: vi.fn(), replaceQuestions: vi.fn() };
vi.mock("@/server/repo/questions", () => ({
  getQuestionContext: (...a: unknown[]) => repo.getQuestionContext(...a),
  replaceQuestions: (...a: unknown[]) => repo.replaceQuestions(...a),
}));

const service = await import("@/server/services/jury-questions");

const SUBJECT: ThemeRef = { id: "t1", name: "Mobilités", description: "", keywords: [], notes: "Note <b>importante</b>." };
const SPEC = makeConformingDeck();
const CONTEXT = { problem: "Comment concilier mobilité et sobriété ?", language: "fr" as const };
const QUESTIONS = { questions: [{ question: "Pourquoi ce sujet ?", answer: "Parce qu'il est central." }] };

function provider(result: () => Promise<unknown>): AiProvider & { generateStructured: ReturnType<typeof vi.fn> } {
  return {
    name: "fake",
    engine: "mistral",
    generateDeck: vi.fn(),
    classify: vi.fn(),
    generateStructured: vi.fn(async () => result()),
  } as unknown as AiProvider & { generateStructured: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  repo.getQuestionContext.mockReset().mockResolvedValue({ programId: "p1", spec: SPEC, subject: SUBJECT });
  repo.replaceQuestions.mockReset().mockImplementation(async (_u: string, _d: string, items: unknown[]) => ({
    programId: "p1",
    questions: items.map((q, i) => ({ id: `q${i}`, status: null, ...(q as object) })),
  }));
});

describe("aiJuryQuestionsGenerator", () => {
  it("devrait appeler la tâche juryQuestions avec le diaporama, le sujet et un prompt neutralisé", async () => {
    const ai = provider(async () => QUESTIONS);
    const generator = service.aiJuryQuestionsGenerator(ai, "mistral", CONTEXT);
    expect(generator.engine).toBe("mistral");

    const result = await service.generateJuryQuestions("u1", "d1", { generator });

    expect(result).toEqual({
      programId: "p1",
      engine: "mistral",
      questions: [{ id: "q0", status: null, ...QUESTIONS.questions[0] }],
    });
    const request = ai.generateStructured.mock.calls[0]![0] as StructuredRequest;
    expect(request.task).toBe("juryQuestions");
    expect(request.hints).toEqual({ spec: SPEC, subject: SUBJECT });
    expect(request.prompt.user).toContain(CONTEXT.problem);
    expect(request.prompt.user).toContain("Note ‹b›importante‹/b›.");
    expect(request.prompt.system).not.toContain("Mobilités");
  });

  it("devrait revalider la sortie et refuser une réponse hors schéma sans rien écrire", async () => {
    const generator = service.aiJuryQuestionsGenerator(provider(async () => ({ questions: [] })), "mistral", CONTEXT);
    await expect(service.generateJuryQuestions("u1", "d1", { generator })).rejects.toBeInstanceOf(AiInvalidOutputError);
    expect(repo.replaceQuestions).not.toHaveBeenCalled();
  });

  it("devrait laisser remonter l'erreur IA, sans repli sur les questions sans IA", async () => {
    const failure = new AiUnavailableError("down", { refundable: true });
    const generator = service.aiJuryQuestionsGenerator(
      provider(async () => {
        throw failure;
      }),
      "mistral",
      CONTEXT,
    );
    await expect(service.generateJuryQuestions("u1", "d1", { generator })).rejects.toBe(failure);
    expect(repo.replaceQuestions).not.toHaveBeenCalled();
  });
});

describe("juryQuestionsGeneratorFor", () => {
  it("devrait choisir la version sans IA seulement pour un utilisateur Sans IA", () => {
    expect(service.juryQuestionsGeneratorFor({ engine: "free" }, CONTEXT)).toBe(service.fallbackJuryQuestionsGenerator);
  });

  it("devrait choisir l'IA du rédacteur de l'utilisateur", async () => {
    const ai = provider(async () => QUESTIONS);
    const generator = service.juryQuestionsGeneratorFor({ engine: "ollama", provider: ai, billing: "local" }, CONTEXT);
    expect(generator.engine).toBe("ollama");
    await generator.generate({ spec: SPEC, subject: null });
    expect(ai.generateStructured).toHaveBeenCalledTimes(1);
  });
});

describe("generateJuryQuestions — demandes simultanées", () => {
  it("devrait fusionner deux demandes simultanées du même utilisateur sur le même diaporama (un seul appel)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const generate = vi.fn(async () => {
      await gate;
      return QUESTIONS;
    });
    const generator = { engine: "mistral" as const, generate };
    const first = service.generateJuryQuestions("u1", "d1", { generator });
    const second = service.generateJuryQuestions("u1", "d1", { generator });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    release();
    expect(await first).toEqual(await second);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(repo.replaceQuestions).toHaveBeenCalledTimes(1);
  });

  it("ne devrait pas fusionner les demandes de deux utilisateurs", async () => {
    const generate = vi.fn(async () => QUESTIONS);
    const generator = { engine: "mistral" as const, generate };
    await Promise.all([
      service.generateJuryQuestions("u1", "d1", { generator }),
      service.generateJuryQuestions("u2", "d1", { generator }),
    ]);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
