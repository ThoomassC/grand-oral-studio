import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import { RETIRED_FORMAT_MESSAGE } from "@/domain/import/file-kind";
import type { PromptTemplate } from "@/domain/schemas";
import { buildPptx, buildThmx, FAKE_PDF, JPEG_HEADER, PNG_1PX } from "@/domain/import/__tests__/fixtures";
import { NotFoundError, RateLimitedError, ValidationError } from "@/server/errors";
import {
  analyzeBrandFile,
  analyzeTemplatePrompt,
  type ImportFile,
  type ImportsDeps,
  type ImportsQuotas,
  type ImportsRepo,
} from "@/server/services/imports";
import { recordingLogger } from "./helpers";

/**
 * Service d'import, sans base ni réseau : dépôt et quotas injectés. Depuis la
 * 1.1.0, aucun import ne passe par une IA : les dépendances n'ont plus de
 * moteur, et seul le quota d'import est consommé.
 */

function file(name: string, bytes: Uint8Array): ImportFile & { reads: number } {
  const f = {
    name,
    size: bytes.byteLength,
    reads: 0,
    async bytes() {
      f.reads += 1;
      return bytes;
    },
  };
  return f;
}

function fakeRepo(owner = "user-a", template: PromptTemplate = defaultTemplate()): ImportsRepo {
  return {
    async assertProgramOwned(userId) {
      if (userId !== owner) throw new NotFoundError("programme");
    },
    async getProgramTemplate(userId) {
      if (userId !== owner) throw new NotFoundError("programme");
      return template;
    },
    async getProgramBrand(userId) {
      if (userId !== owner) throw new NotFoundError("programme");
      return defaultBrand();
    },
  };
}

function fakeQuotas(overrides: Partial<ImportsQuotas> = {}) {
  const calls: string[] = [];
  const quotas: ImportsQuotas = {
    consumeImport: overrides.consumeImport ?? (async () => void calls.push("import")),
  };
  return { quotas, calls };
}

function deps(quotas: ImportsQuotas, repo = fakeRepo()) {
  const log = recordingLogger();
  const d: ImportsDeps = { log, repo, quotas };
  return { deps: d, log };
}

describe("analyzeBrandFile — fichiers Office (déterministe)", () => {
  it("devrait déduire l'apparence d'un .pptx en ne consommant qu'une unité d'import", async () => {
    const { quotas, calls } = fakeQuotas();
    const bytes = await buildPptx({ name: "Maison", colors: { accent1: "112233" }, major: "Georgia", minor: "Arial" });
    const out = await analyzeBrandFile("user-a", "prog-1", file("apparence.pptx", bytes), deps(quotas).deps);
    expect(out.brand.colors.primary).toBe("#112233");
    expect(out.brand.fonts.heading).toBe("Georgia");
    expect(out).not.toHaveProperty("source");
    expect(calls).toEqual(["import"]);
  });

  it("devrait lire un .thmx", async () => {
    const out = await analyzeBrandFile("user-a", "p", file("theme.thmx", await buildThmx({ name: "T" })), deps(fakeQuotas().quotas).deps);
    expect(out.brand.name).toBe("T");
  });

  it("devrait être déterministe (même fichier → même apparence)", async () => {
    const bytes = await buildPptx({ name: "Maison" });
    const run = () => analyzeBrandFile("user-a", "p", file("a.potx", bytes), deps(fakeQuotas().quotas).deps);
    expect(await run()).toEqual(await run());
  });
});

describe("analyzeBrandFile — refus", () => {
  it("devrait renvoyer NotFoundError à un non-propriétaire, avant toute lecture ni quota", async () => {
    const { quotas, calls } = fakeQuotas();
    const f = file("apparence.pptx", await buildPptx());
    await expect(analyzeBrandFile("user-b", "prog-1", f, deps(quotas).deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(f.reads).toBe(0);
    expect(calls).toEqual([]);
  });

  it.each([
    ["macro.pptm", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])],
    ["faux.pptx", FAKE_PDF],
    ["notes.txt", new TextEncoder().encode("bonjour")],
  ])("devrait refuser %s (extension ou signature) en erreur attendue", async (name, bytes) => {
    const { quotas, calls } = fakeQuotas();
    await expect(analyzeBrandFile("user-a", "p", file(name, bytes), deps(quotas).deps)).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toEqual(["import"]);
  });

  it.each([
    ["apparence.pdf", FAKE_PDF],
    ["logo.png", PNG_1PX],
    ["photo.jpg", JPEG_HEADER],
  ])("devrait refuser %s : l'import depuis un PDF ou une image n'est plus proposé", async (name, bytes) => {
    const { quotas, calls } = fakeQuotas();
    const error = await analyzeBrandFile("user-a", "p", file(name, bytes), deps(quotas).deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).userMessage).toBe(RETIRED_FORMAT_MESSAGE);
    expect((error as ValidationError).fieldErrors).toEqual({ file: [RETIRED_FORMAT_MESSAGE] });
    expect(calls).toEqual(["import"]);
  });

  it("devrait refuser un fichier de plus de 20 Mo sans le lire", async () => {
    const f = { name: "gros.pptx", size: 20 * 1024 * 1024 + 1, reads: 0, bytes: vi.fn() };
    await expect(analyzeBrandFile("user-a", "p", f, deps(fakeQuotas().quotas).deps)).rejects.toBeInstanceOf(ValidationError);
    expect(f.bytes).not.toHaveBeenCalled();
  });

  it("devrait propager la limite de débit des imports, sans lire le fichier", async () => {
    const { quotas } = fakeQuotas({
      consumeImport: async () => {
        throw new RateLimitedError(600, "import");
      },
    });
    const f = file("a.pptx", await buildPptx());
    await expect(analyzeBrandFile("user-a", "p", f, deps(quotas).deps)).rejects.toThrow(/Trop d'imports/);
    expect(f.reads).toBe(0);
  });

  it("ne devrait journaliser ni le contenu ni le nom du fichier", async () => {
    const { deps: d, log } = deps(fakeQuotas().quotas);
    await analyzeBrandFile("user-a", "p", file("secret-client.pptx", await buildPptx()), d);
    await analyzeBrandFile("user-a", "p", file("secret-client.pdf", FAKE_PDF), d).catch(() => undefined);
    const dump = JSON.stringify(log.events);
    expect(log.events.length).toBeGreaterThan(0);
    expect(dump).not.toContain("secret-client");
    expect(dump).not.toContain(Buffer.from(FAKE_PDF).toString("base64"));
  });
});

describe("analyzeTemplatePrompt — lecture déterministe", () => {
  const TEXT = "Durée : 12 min\nFormat 4:3\n1. Introduction : présenter le sujet\n2. Analyse (3 diapos)\n3. Conclusion";
  const base = defaultTemplate();

  let quotas: ReturnType<typeof fakeQuotas>;
  beforeEach(() => {
    quotas = fakeQuotas();
  });

  it("devrait lire le texte sans IA, en ne consommant qu'une unité d'import", async () => {
    const out = await analyzeTemplatePrompt("user-a", "p", { text: TEXT }, deps(quotas.quotas).deps);
    expect(out.template.durationMinutes).toBe(12);
    expect(out.template.format).toBe("4:3");
    expect(out.template.sections).toHaveLength(3);
    expect(out.recognized).toEqual(["durationMinutes", "format", "sections", "constraints"]);
    expect(out.warnings).toEqual([]);
    expect(out).not.toHaveProperty("source");
    expect(out).not.toHaveProperty("fallbackReason");
    expect(quotas.calls).toEqual(["import"]);
  });

  it("devrait partir de la trame actuelle du projet", async () => {
    const current: PromptTemplate = { ...base, tone: "Ton maison", language: "en" };
    const out = await analyzeTemplatePrompt("user-a", "p", { text: "Durée : 8 min" }, deps(quotas.quotas, fakeRepo("user-a", current)).deps);
    expect(out.template.tone).toBe("Ton maison");
    expect(out.template.language).toBe("en");
    expect(out.template.durationMinutes).toBe(8);
  });

  it("devrait lire la colonne Durée d'un tableau de diapos", async () => {
    const text = [
      "| Diapo | Titre | Contenu type | Durée |",
      "|---|---|---|---|",
      "| 1 | Titre | Problématique | 0:30 |",
      "| 2-3 | Contexte | Enjeu, chiffres clés | 3:00 |",
      "| 4 | Conclusion | Réponse | 1:30 |",
    ].join("\n");
    const out = await analyzeTemplatePrompt("user-a", "p", { text }, deps(quotas.quotas).deps);
    expect(out.template.sections.map((s) => [s.title, s.slides, s.seconds])).toEqual([
      ["Contexte", 2, 180],
      ["Conclusion", 1, 90],
    ]);
    expect(out.template.durationMinutes).toBe(5);
  });

  it("devrait renvoyer NotFoundError à un non-propriétaire, avant le quota", async () => {
    await expect(analyzeTemplatePrompt("user-b", "p", { text: TEXT }, deps(quotas.quotas).deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(quotas.calls).toEqual([]);
  });

  it("devrait propager la limite de débit des imports", async () => {
    const q = fakeQuotas({
      consumeImport: async () => {
        throw new RateLimitedError(60, "import");
      },
    });
    await expect(analyzeTemplatePrompt("user-a", "p", { text: TEXT }, deps(q.quotas).deps)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("ne devrait jamais journaliser le texte", async () => {
    const secret = "SECRET-PERSONNEL-42";
    const { deps: d, log } = deps(quotas.quotas);
    await analyzeTemplatePrompt("user-a", "p", { text: `1. ${secret}\n2. Autre` }, d);
    expect(log.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(log.events)).not.toContain(secret);
  });
});
