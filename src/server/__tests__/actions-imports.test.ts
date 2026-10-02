import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Couche de transport des imports : session, moteur et service isolés ; on
 * vérifie la validation au bord (FormData, taille, longueur) et ce qui est
 * transmis au service.
 */

vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("@/server/session", () => ({
  requireUser: async () => ({ id: "user-1", email: "u@example.test", name: "U" }),
}));
const getEngineForUser = vi.fn(async () => ({ engine: "free" as const }));
vi.mock("@/server/ai", () => ({ getEngineForUser: () => getEngineForUser() }));

const service = { analyzeBrandFile: vi.fn(), analyzeTemplatePrompt: vi.fn() };
vi.mock("@/server/services/imports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/imports")>();
  return {
    ...actual,
    analyzeBrandFile: (...args: unknown[]) => service.analyzeBrandFile(...args),
    analyzeTemplatePrompt: (...args: unknown[]) => service.analyzeTemplatePrompt(...args),
  };
});

const actions = await import("@/server/actions/imports");

beforeEach(() => {
  service.analyzeBrandFile.mockReset();
  service.analyzeTemplatePrompt.mockReset();
  getEngineForUser.mockClear();
});

function form(file?: File): FormData {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return fd;
}

describe("action analyzeBrandFile", () => {
  it("devrait transmettre le fichier (nom, taille, octets) au service", async () => {
    service.analyzeBrandFile.mockResolvedValue({ brand: {}, notes: [], source: "office" });
    const result = await actions.analyzeBrandFile("prog-1", form(new File([new Uint8Array([1, 2, 3])], "charte.pptx")));
    expect(result.ok).toBe(true);
    const [userId, programId, input] = service.analyzeBrandFile.mock.calls[0]! as [string, string, { name: string; size: number; bytes: () => Promise<Uint8Array> }];
    expect([userId, programId, input.name, input.size]).toEqual(["user-1", "prog-1", "charte.pptx", 3]);
    expect([...(await input.bytes())]).toEqual([1, 2, 3]);
    // Le moteur n'est résolu qu'à la demande du service.
    expect(getEngineForUser).not.toHaveBeenCalled();
  });

  it.each([
    ["sans fichier", form()],
    ["champ texte au lieu d'un fichier", (() => { const fd = new FormData(); fd.set("file", "x"); return fd; })()],
    ["fichier vide", form(new File([], "a.pptx"))],
    ["autre chose qu'un FormData", { file: "x" } as unknown as FormData],
  ])("devrait refuser %s sans appeler le service", async (_label, fd) => {
    const result = await actions.analyzeBrandFile("prog-1", fd);
    expect(result.ok).toBe(false);
    expect(service.analyzeBrandFile).not.toHaveBeenCalled();
  });

  it("devrait refuser un fichier de plus de 20 Mo", async () => {
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "gros.pptx");
    const result = await actions.analyzeBrandFile("prog-1", form(big));
    expect(result).toMatchObject({ ok: false });
    expect(service.analyzeBrandFile).not.toHaveBeenCalled();
  });

  it("devrait refuser un identifiant de projet invalide", async () => {
    const result = await actions.analyzeBrandFile("../x", form(new File([new Uint8Array([1])], "a.pptx")));
    expect(result.ok).toBe(false);
    expect(service.analyzeBrandFile).not.toHaveBeenCalled();
  });

  it("ne devrait jamais renvoyer le message brut d'une panne", async () => {
    service.analyzeBrandFile.mockRejectedValue(new Error("ECONNRESET db secret"));
    const result = await actions.analyzeBrandFile("prog-1", form(new File([new Uint8Array([1])], "a.pptx")));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("action analyzeTemplatePrompt", () => {
  it("devrait transmettre le texte validé", async () => {
    service.analyzeTemplatePrompt.mockResolvedValue({ template: {}, found: [], source: "free", fallbackReason: null });
    const result = await actions.analyzeTemplatePrompt("prog-1", { text: "Durée : 10 min" });
    expect(result.ok).toBe(true);
    expect(service.analyzeTemplatePrompt.mock.calls[0]!.slice(0, 3)).toEqual(["user-1", "prog-1", { text: "Durée : 10 min" }]);
  });

  it.each([
    ["vide", { text: "   " }],
    ["trop long", { text: "a".repeat(20_001) }],
    ["mal formé", { text: 42 } as unknown as { text: string }],
  ])("devrait refuser un texte %s", async (_label, input) => {
    const result = await actions.analyzeTemplatePrompt("prog-1", input);
    expect(result.ok).toBe(false);
    expect(service.analyzeTemplatePrompt).not.toHaveBeenCalled();
  });

  it("devrait accepter exactement 20 000 caractères", async () => {
    service.analyzeTemplatePrompt.mockResolvedValue({ template: {}, found: [], source: "free", fallbackReason: null });
    expect((await actions.analyzeTemplatePrompt("prog-1", { text: "a".repeat(20_000) })).ok).toBe(true);
  });
});
