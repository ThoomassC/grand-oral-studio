import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/server/errors";

/** Transport des actions Paramètres : session, revalidation, traduction des erreurs. */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("@/server/session", () => ({
  requireUser: async () => ({ id: "user-1", email: "u@example.test", name: "U" }),
}));

const service = { saveApiKey: vi.fn(), deleteApiKey: vi.fn(), testEffectiveKey: vi.fn(), setEngine: vi.fn() };
vi.mock("@/server/services/ai-settings", () => ({
  saveApiKey: (...args: unknown[]) => service.saveApiKey(...args),
  deleteApiKey: (...args: unknown[]) => service.deleteApiKey(...args),
  testEffectiveKey: (...args: unknown[]) => service.testEffectiveKey(...args),
  setEngine: (...args: unknown[]) => service.setEngine(...args),
}));

const actions = await import("@/server/actions/settings");

beforeEach(() => {
  revalidatePath.mockReset();
  for (const fn of Object.values(service)) fn.mockReset();
});

describe("saveAnthropicApiKey", () => {
  it("devrait enregistrer pour l'utilisateur connecté, renvoyer les 4 derniers caractères et revalider /parametres", async () => {
    service.saveApiKey.mockResolvedValue({ last4: "AAAA" });
    const result = await actions.saveAnthropicApiKey({ apiKey: "sk-ant-x" });
    expect(result).toEqual({ ok: true, data: { last4: "AAAA" } });
    expect(service.saveApiKey.mock.calls[0]![0]).toBe("user-1");
    expect(revalidatePath).toHaveBeenCalledWith("/parametres");
  });

  it("devrait transmettre l'erreur de champ apiKey au client", async () => {
    service.saveApiKey.mockRejectedValue(new ValidationError("Cette clé est refusée", { apiKey: ["Cette clé est refusée"] }));
    const result = await actions.saveAnthropicApiKey({ apiKey: "sk-ant-x" });
    expect(result).toEqual({ ok: false, error: "Cette clé est refusée", fieldErrors: { apiKey: ["Cette clé est refusée"] } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("ne devrait jamais renvoyer le message brut d'une panne (qui pourrait contenir la clé)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    service.saveApiKey.mockRejectedValue(new Error("boom sk-ant-api03-secret"));
    const result = await actions.saveAnthropicApiKey({ apiKey: "sk-ant-api03-secret" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("deleteAnthropicApiKey / testAnthropicApiKey", () => {
  it("devrait supprimer et renvoyer null", async () => {
    service.deleteApiKey.mockResolvedValue(undefined);
    expect(await actions.deleteAnthropicApiKey()).toEqual({ ok: true, data: null });
    expect(service.deleteApiKey.mock.calls[0]![0]).toBe("user-1");
    expect(revalidatePath).toHaveBeenCalledWith("/parametres");
  });

  it("devrait renvoyer la source et le modèle testés", async () => {
    service.testEffectiveKey.mockResolvedValue({ source: "user", model: "claude-opus-5-5" });
    expect(await actions.testAnthropicApiKey()).toEqual({ ok: true, data: { source: "user", model: "claude-opus-5-5" } });
  });
});

describe("setAiEngine", () => {
  it("devrait enregistrer le moteur de l'utilisateur connecté, avec l'environnement du serveur, et revalider", async () => {
    service.setEngine.mockResolvedValue(undefined);
    expect(await actions.setAiEngine({ engine: "free" })).toEqual({ ok: true, data: null });
    const [userId, input, deps] = service.setEngine.mock.calls[0]! as [string, unknown, { env: unknown; listOllamaModels: unknown }];
    expect(userId).toBe("user-1");
    expect(input).toEqual({ engine: "free" });
    expect(deps.env).toBe(process.env);
    expect(typeof deps.listOllamaModels).toBe("function");
    expect(revalidatePath).toHaveBeenCalledWith("/parametres");
  });

  it("devrait transmettre l'erreur de champ ollamaModel", async () => {
    service.setEngine.mockRejectedValue(new ValidationError("absent", { ollamaModel: ["absent"] }));
    expect(await actions.setAiEngine({ engine: "ollama", ollamaModel: "x" })).toEqual({
      ok: false,
      error: "absent",
      fieldErrors: { ollamaModel: ["absent"] },
    });
  });
});
