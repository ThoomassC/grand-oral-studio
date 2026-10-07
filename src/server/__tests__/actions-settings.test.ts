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
const verifyProviderKey = vi.fn();
vi.mock("@/server/ai/verify-key", () => ({
  verifyAnthropicKey: vi.fn(),
  verifyProviderKey: (...args: unknown[]) => verifyProviderKey(...args),
}));

const service = {
  activateClaudeWithKey: vi.fn(),
  deleteApiKey: vi.fn(),
  testEffectiveKey: vi.fn(),
  setEngine: vi.fn(),
  connectProvider: vi.fn(),
  selectWriter: vi.fn(),
  testConnection: vi.fn(),
  deleteConnection: vi.fn(),
  setConnectionModel: vi.fn(),
};
vi.mock("@/server/services/ai-settings", () => ({
  activateClaudeWithKey: (...args: unknown[]) => service.activateClaudeWithKey(...args),
  deleteApiKey: (...args: unknown[]) => service.deleteApiKey(...args),
  testEffectiveKey: (...args: unknown[]) => service.testEffectiveKey(...args),
  setEngine: (...args: unknown[]) => service.setEngine(...args),
  connectProvider: (...args: unknown[]) => service.connectProvider(...args),
  selectWriter: (...args: unknown[]) => service.selectWriter(...args),
  testConnection: (...args: unknown[]) => service.testConnection(...args),
  deleteConnection: (...args: unknown[]) => service.deleteConnection(...args),
  setConnectionModel: (...args: unknown[]) => service.setConnectionModel(...args),
}));

const actions = await import("@/server/actions/settings");

beforeEach(() => {
  signedIn = true;
  revalidatePath.mockReset();
  for (const fn of Object.values(service)) fn.mockReset();
  verifyProviderKey.mockReset();
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

describe("connexions par fournisseur (1.2)", () => {
  it("devrait connecter un fournisseur pour l'utilisateur connecté, vérifier via le bon fournisseur et revalider", async () => {
    service.connectProvider.mockResolvedValue({ provider: "mistral", last4: "MMMM", model: "mistral-large-latest" });
    verifyProviderKey.mockResolvedValue({ ok: true });
    const input = { provider: "mistral" as const, apiKey: "k", activate: true };
    expect(await actions.connectProvider(input)).toEqual({ ok: true, data: { provider: "mistral", last4: "MMMM", model: "mistral-large-latest" } });
    const [userId, passed, deps] = service.connectProvider.mock.calls[0]! as [string, unknown, { env: unknown; verifyKey: (p: string, k: string) => Promise<unknown> }];
    expect(userId).toBe("user-1");
    expect(passed).toEqual(input);
    expect(deps.env).toBe(process.env);
    await deps.verifyKey("mistral", "k");
    expect(verifyProviderKey).toHaveBeenCalledWith("mistral", "k");
    expect(revalidatePath).toHaveBeenCalledWith("/configuration-ia");
  });

  it("devrait transmettre l'erreur de champ apiKey sans jamais renvoyer la clé", async () => {
    service.connectProvider.mockRejectedValue(new ValidationError("Cette clé est refusée par Mistral.", { apiKey: ["Cette clé est refusée par Mistral."] }));
    const result = await actions.connectProvider({ provider: "mistral", apiKey: SECRET });
    expect(result).toEqual({ ok: false, error: "Cette clé est refusée par Mistral.", fieldErrors: { apiKey: ["Cette clé est refusée par Mistral."] } });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("devrait choisir le rédacteur, tester, changer de modèle et supprimer pour l'utilisateur connecté", async () => {
    service.selectWriter.mockResolvedValue(undefined);
    service.testConnection.mockResolvedValue({ provider: "gemini", model: "gemini-2.5-flash", verifiedAt: "2026-10-07T00:00:00.000Z" });
    service.setConnectionModel.mockResolvedValue(undefined);
    service.deleteConnection.mockResolvedValue(undefined);
    expect(await actions.selectWriter({ engine: "gemini", keySource: "server" })).toEqual({ ok: true, data: null });
    expect(await actions.testConnection({ provider: "gemini" })).toMatchObject({ ok: true, data: { provider: "gemini" } });
    expect(await actions.setConnectionModel({ provider: "gemini", model: "gemini-2.5-pro" })).toEqual({ ok: true, data: null });
    expect(await actions.deleteConnection({ provider: "gemini" })).toEqual({ ok: true, data: null });
    for (const fn of [service.selectWriter, service.testConnection, service.setConnectionModel, service.deleteConnection]) {
      expect(fn.mock.calls[0]![0]).toBe("user-1");
    }
    expect(revalidatePath).toHaveBeenCalledTimes(4);
  });

  it("devrait refuser sans session, sans appeler le service", async () => {
    signedIn = false;
    expect((await actions.selectWriter({ engine: "free" })).ok).toBe(false);
    expect((await actions.deleteConnection({ provider: "openai" })).ok).toBe(false);
    expect(service.selectWriter).not.toHaveBeenCalled();
    expect(service.deleteConnection).not.toHaveBeenCalled();
  });
});
