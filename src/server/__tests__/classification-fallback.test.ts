import { describe, expect, it } from "vitest";
import type { ProgramContext } from "@/domain/contracts";
import type { Classification } from "@/domain/schemas";
import { classifyWithFallback } from "@/server/services/classification";
import { AiInvalidOutputError, AiKeyRejectedError, AiRefusalError, AiUnavailableError } from "@/server/errors";
import { makeTemplate } from "@/test/fixtures";
import { recordingLogger } from "./helpers";

const CTX: ProgramContext = {
  name: "P",
  description: "",
  template: makeTemplate(),
  themes: [
    { id: "t-energie", name: "Transition énergétique", description: "Énergie et climat", keywords: ["énergie", "climat"], notes: "" },
    { id: "t-numerique", name: "Numérique", description: "Internet et données", keywords: ["internet", "données"], notes: "" },
  ],
};
const PROBLEM = "Comment réduire la consommation de données sur internet ?";

describe("classifyWithFallback", () => {
  it("devrait renvoyer la classification de l'IA avec source « ai »", async () => {
    const raw: Classification = {
      reformulatedProblem: "Réduire la consommation de données",
      candidates: [{ themeId: "t-numerique", confidence: 0.9, rationale: "internet" }],
    };
    const result = await classifyWithFallback(CTX, { problem: PROBLEM }, async () => raw, recordingLogger());
    expect(result.source).toBe("ai");
    expect(result.fallbackReason).toBeNull();
    expect(result.ranked[0]!.themeId).toBe("t-numerique");
  });

  it.each([
    ["indisponible", new AiUnavailableError("down")],
    ["refus", new AiRefusalError("cyber")],
    ["sortie invalide", new AiInvalidOutputError("bad")],
    ["clé refusée", new AiKeyRejectedError()],
  ])("devrait se replier sur la reconnaissance sans IA en cas d'échec (%s)", async (_label, error) => {
    const log = recordingLogger();
    const result = await classifyWithFallback(CTX, { problem: PROBLEM }, async () => Promise.reject(error), log);
    expect(result.source).toBe("free");
    expect(result.fallbackReason).toBeTruthy();
    expect(result.ranked[0]!.themeId).toBe("t-numerique");
    expect(log.events.some((e) => e.event === "classify.fallback_free")).toBe(true);
  });

  it("devrait se replier quand l'IA ne renvoie que des thèmes inconnus", async () => {
    const raw: Classification = {
      reformulatedProblem: "x",
      candidates: [{ themeId: "inconnu", confidence: 0.9, rationale: "r" }],
    };
    const result = await classifyWithFallback(CTX, { problem: PROBLEM }, async () => raw, recordingLogger());
    expect(result.source).toBe("free");
    expect(result.ranked.length).toBeGreaterThan(0);
  });

  it("devrait utiliser directement le moteur gratuit sans tentative IA (attempt = null)", async () => {
    const result = await classifyWithFallback(CTX, { problem: PROBLEM }, null, recordingLogger());
    expect(result).toMatchObject({ source: "free", fallbackReason: null });
  });

  it("devrait conserver le thème annoncé en tête en mode gratuit", async () => {
    const result = await classifyWithFallback(CTX, { problem: PROBLEM, hintedThemeId: "t-energie" }, null, recordingLogger());
    expect(result.ranked[0]!.themeId).toBe("t-energie");
  });
});

describe("classifyWithFallback — correctifs de revue", () => {
  // B5 : les messages utiles (Ollama arrêté, modèle absent) doivent atteindre l'interface.
  it("devrait reprendre le message de l'indisponibilité", async () => {
    const error = new AiUnavailableError("x", { userMessage: "Ollama ne répond pas à http://localhost:11434 : vérifiez qu'il est lancé (ollama serve)." });
    const result = await classifyWithFallback(CTX, { problem: PROBLEM }, async () => Promise.reject(error), recordingLogger());
    expect(result.fallbackReason).toBe(error.userMessage);
  });

  // B8 : un bug de code ou une panne Prisma ne se maquille pas en repli gratuit.
  it("devrait relancer une erreur qui n'est pas une AppError", async () => {
    const boom = new TypeError("bug");
    await expect(classifyWithFallback(CTX, { problem: PROBLEM }, async () => Promise.reject(boom), recordingLogger())).rejects.toBe(boom);
  });
});
