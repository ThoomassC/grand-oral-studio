import { beforeEach, describe, expect, it } from "vitest";
import { defaultBrand, defaultTemplate } from "@/domain/defaults";
import type { Brand } from "@/domain/schemas";
import { NotFoundError, RateLimitedError } from "@/server/errors";
import {
  analyzeThemePrompt,
  ThemePromptInputSchema,
  type ImportsDeps,
  type ImportsQuotas,
  type ImportsRepo,
} from "@/server/services/imports";
import { recordingLogger } from "./helpers";

/**
 * analyzeThemePrompt sans base ni réseau : dépôt et quotas injectés. Sujets et
 * apparence sont lus sans IA, de façon déterministe.
 */

const CURRENT: Brand = {
  name: "Mon apparence",
  colors: { primary: "#112233", secondary: "#445566", accent: "#AA5500", background: "#FFFFFF", text: "#222222" },
  fonts: { heading: "Montserrat", body: "Lato" },
  logoDataUrl: null,
};

const TEXT = "Mon grand oral.\nThèmes :\n1. Inflation\n2. Chômage\n3. Croissance\nCouleur principale : #1F3A5F. Police des titres : Georgia.";

function fakeRepo(owner = "user-a", brand: Brand = CURRENT): ImportsRepo & { brandReads: number } {
  const repo = {
    brandReads: 0,
    async assertProgramOwned(userId: string) {
      if (userId !== owner) throw new NotFoundError("programme");
    },
    async getProgramTemplate(userId: string) {
      if (userId !== owner) throw new NotFoundError("programme");
      return defaultTemplate();
    },
    async getProgramBrand(userId: string) {
      repo.brandReads += 1;
      if (userId !== owner) throw new NotFoundError("programme");
      return brand;
    },
  };
  return repo;
}

function fakeQuotas(overrides: Partial<ImportsQuotas> = {}) {
  const calls: string[] = [];
  const quotas: ImportsQuotas = {
    consumeImport: overrides.consumeImport ?? (async () => void calls.push("import")),
  };
  return { quotas, calls };
}

function deps(quotas: ImportsQuotas, repo: ImportsRepo = fakeRepo()) {
  const log = recordingLogger();
  const d: ImportsDeps = { log, repo, quotas };
  return { deps: d, log };
}

describe("ThemePromptInputSchema (bord)", () => {
  it("devrait refuser un texte vide ou de plus de 20 000 caractères", () => {
    expect(ThemePromptInputSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(ThemePromptInputSchema.safeParse({ text: "x".repeat(20_001) }).success).toBe(false);
    expect(ThemePromptInputSchema.safeParse({ text: "x".repeat(20_000) }).success).toBe(true);
  });
});

describe("analyzeThemePrompt", () => {
  let quotas: ReturnType<typeof fakeQuotas>;
  beforeEach(() => {
    quotas = fakeQuotas();
  });

  it("devrait lire sujets et apparence sans IA, en ne consommant qu'une unité d'import", async () => {
    const out = await analyzeThemePrompt("user-a", "p", { text: TEXT }, deps(quotas.quotas).deps);
    expect(out.themes.map((t) => t.name)).toEqual(["Inflation", "Chômage", "Croissance"]);
    expect(out.brand).toEqual({ ...CURRENT, colors: { ...CURRENT.colors, primary: "#1F3A5F" }, fonts: { heading: "Georgia", body: "Lato" } });
    expect(out.brandFound).toEqual(["Couleur principale : #1F3A5F", "Police des titres : Georgia"]);
    expect(out).not.toHaveProperty("source");
    expect(out).not.toHaveProperty("fallbackReason");
    expect(quotas.calls).toEqual(["import"]);
  });

  it("devrait être déterministe", async () => {
    const run = () => analyzeThemePrompt("user-a", "p", { text: TEXT }, deps(fakeQuotas().quotas).deps);
    expect(await run()).toEqual(await run());
  });

  it("devrait renvoyer NotFoundError à un non-propriétaire, avant le quota", async () => {
    await expect(analyzeThemePrompt("user-b", "p", { text: TEXT }, deps(quotas.quotas).deps)).rejects.toBeInstanceOf(NotFoundError);
    expect(quotas.calls).toEqual([]);
  });

  it("devrait propager la limite de débit des imports", async () => {
    const q = fakeQuotas({
      consumeImport: async () => {
        throw new RateLimitedError(60, "import");
      },
    });
    await expect(analyzeThemePrompt("user-a", "p", { text: TEXT }, deps(q.quotas).deps)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("devrait partir de l'apparence actuelle du projet", async () => {
    const repo = fakeRepo("user-a", defaultBrand());
    const out = await analyzeThemePrompt("user-a", "p", { text: "Fond : #FAFAFA" }, deps(quotas.quotas, repo).deps);
    expect(out.brand).toEqual({ ...defaultBrand(), colors: { ...defaultBrand().colors, background: "#FAFAFA" } });
    expect(repo.brandReads).toBe(1);
  });

  it("ne devrait jamais journaliser le texte", async () => {
    const secret = "SECRET-PERSONNEL-42";
    const { deps: d, log } = deps(quotas.quotas);
    await analyzeThemePrompt("user-a", "p", { text: `1. ${secret}\n2. Autre` }, d);
    expect(JSON.stringify(log.events)).not.toContain(secret);
    expect(log.events.length).toBeGreaterThan(0);
  });
});
