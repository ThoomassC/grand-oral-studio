import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthenticatedError, ValidationError } from "@/server/errors";

/** Transport des actions Configuration IA : session, revalidation, traduction des erreurs. */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
let signedIn = true;
vi.mock("@/server/session", () => ({
  requireUser: async () => {
    if (!signedIn) throw new UnauthenticatedError();
    return { id: "user-1", email: "u@example.test", name: "U" };
  },
}));

// Transport seulement : les sondes réseau (Ollama, vérification de clé) ne sont jamais appelées ici.
vi.mock("@/server/ai/ollama", () => ({ listOllamaModels: vi.fn() }));
vi.mock("@/server/ai/verify-key", () => ({ verifyAnthropicKey: vi.fn() }));

const service = { activateClaudeWithKey: vi.fn(), deleteApiKey: vi.fn(), testEffectiveKey: vi.fn(), setEngine: vi.fn() };
vi.mock("@/server/services/ai-settings", () => ({
  activateClaudeWithKey: (...args: unknown[]) => service.activateClaudeWithKey(...args),
  deleteApiKey: (...args: unknown[]) => service.deleteApiKey(...args),
  testEffectiveKey: (...args: unknown[]) => service.testEffectiveKey(...args),
  setEngine: (...args: unknown[]) => service.setEngine(...args),
}));

const actions = await import("@/server/actions/settings");

beforeEach(() => {
  signedIn = true;
  revalidatePath.mockReset();
  for (const fn of Object.values(service)) fn.mockReset();
});

const SECRET = "sk-ant-api03-secret-value-0000";

describe("activateClaude", () => {
  it("devrait activer Claude pour l'utilisateur connecté, renvoyer les 4 derniers caractères et revalider /configuration-ia", async () => {
    service.activateClaudeWithKey.mockResolvedValue({ last4: "AAAA" });
    const result = await actions.activateClaude({ apiKey: "sk-ant-x" });
    expect(result).toEqual({ ok: true, data: { last4: "AAAA" } });
    const [userId, input, deps] = service.activateClaudeWithKey.mock.calls[0]! as [string, unknown, { env: unknown; verifyKey: unknown }];
    expect(userId).toBe("user-1");
    expect(input).toEqual({ apiKey: "sk-ant-x" });
    expect(deps.env).toBe(process.env);
    expect(typeof deps.verifyKey).toBe("function");
    expect(revalidatePath).toHaveBeenCalledWith("/configuration-ia");
  });

  it("devrait refuser sans session, sans appeler le service", async () => {
    signedIn = false;
    const result = await actions.activateClaude({ apiKey: SECRET });
    expect(result.ok).toBe(false);
    expect(service.activateClaudeWithKey).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("devrait transmettre l'erreur de champ apiKey au client", async () => {
    service.activateClaudeWithKey.mockRejectedValue(new ValidationError("Cette clé est refusée", { apiKey: ["Cette clé est refusée"] }));
    const result = await actions.activateClaude({ apiKey: "sk-ant-x" });
    expect(result).toEqual({ ok: false, error: "Cette clé est refusée", fieldErrors: { apiKey: ["Cette clé est refusée"] } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("ne devrait jamais renvoyer ni journaliser la clé, même quand une panne la contient", async () => {
    const logged: unknown[] = [];
    const capture = (...args: unknown[]) => void logged.push(args);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(capture));
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => (logged.push(chunk), true));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => (logged.push(chunk), true));
    try {
      service.activateClaudeWithKey.mockRejectedValue(new Error(`boom ${SECRET}`));
      const result = await actions.activateClaude({ apiKey: SECRET });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("secret-value");
      expect(JSON.stringify(logged)).not.toContain("secret-value");
    } finally {
      for (const spy of [...spies, stdout, stderr]) spy.mockRestore();
    }
  });
});

describe("deleteAnthropicApiKey / testAnthropicApiKey", () => {
  it("devrait supprimer et renvoyer null", async () => {
    service.deleteApiKey.mockResolvedValue(undefined);
    expect(await actions.deleteAnthropicApiKey()).toEqual({ ok: true, data: null });
    expect(service.deleteApiKey.mock.calls[0]![0]).toBe("user-1");
    expect(revalidatePath).toHaveBeenCalledWith("/configuration-ia");
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
    expect(revalidatePath).toHaveBeenCalledWith("/configuration-ia");
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
