import { test, expect, loggedInContext } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, importThemeList } from "./support/app";
import { SUBJECTS, chooseFreeWriter, generateDeck, seedLegacySkeleton } from "./support/parcours";
import type { Browser, Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const SECRET_NAME = "Projet confidentiel de A";
const PROBLEM = "Comment protéger les données des entreprises face à la multiplication des attaques par rançongiciel ?";

interface OwnerData {
  programId: string;
  deckId: string;
  skeletonUrl: string;
}

async function ownerWithContent(browser: Browser): Promise<OwnerData & { owner: Page; close: () => Promise<void> }> {
  const { context, page } = await loggedInContext(browser, "securite-a");
  await chooseFreeWriter(page);
  const programId = await createProject(page, SECRET_NAME);
  await importThemeList(page, programId, SUBJECTS.cyber);
  const deckId = await generateDeck(page, programId, PROBLEM, "Cybersécurité");
  // Ancien squelette (version 1.0) : semé en base, il ne se génère plus.
  const skeletonId = await seedLegacySkeleton(deckId, "Squelette confidentiel de A");
  const skeletonUrl = `/projets/${programId}/decks/${skeletonId}`;
  return { programId, deckId, skeletonUrl, owner: page, close: () => context.close() };
}

async function expectNotFoundWithoutLeak(page: Page, path: string) {
  await page.goto(path);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Introuvable" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(SECRET_NAME);
  await expect(page.locator("body")).not.toContainText("Cybersécurité");
  await expect(page.locator("body")).not.toContainText("confidentiel");
  await expect(page).toHaveTitle(/^(?!.*confidentiel).*$/);
}

test.describe("9. Sécurité — cloisonnement entre comptes", () => {
  test("un utilisateur B ne voit ni le projet, ni ses étapes, ni le squelette, ni le deck de A par URL directe", async ({ browser, page, account }) => {
    void account;
    const a = await ownerWithContent(browser);
    try {
      for (const path of [
        `/projets/${a.programId}`,
        `/projets/${a.programId}/apparence`,
        `/projets/${a.programId}/trame`,
        `/projets/${a.programId}/trame/sujets`,
        `/projets/${a.programId}/charte`,
        `/projets/${a.programId}/squelettes`,
        a.skeletonUrl,
        `/projets/${a.programId}/jour-j`,
        `/projets/${a.programId}/decks`,
        `/projets/${a.programId}/decks/${a.deckId}`,
      ]) {
        await test.step(path, () => expectNotFoundWithoutLeak(page, path));
      }
      await page.goto("/projets");
      await expect(page.getByRole("main").getByText("Aucun projet pour l'instant")).toBeVisible();
      // Témoin : le propriétaire, lui, voit bien son deck à la même URL.
      await a.owner.goto(`/projets/${a.programId}/decks/${a.deckId}`);
      await expect(a.owner.getByRole("main").getByText("Diaporama final · Cybersécurité")).toBeVisible();
    } finally {
      await a.close();
    }
  });

  test("un utilisateur B ne peut pas exporter le .pptx d'un deck de A (404, pas 403)", async ({ browser, page, account }) => {
    void account;
    const a = await ownerWithContent(browser);
    try {
      // Témoin : le propriétaire obtient le fichier.
      expect((await a.owner.request.get(`/api/decks/${a.deckId}/pptx`)).status()).toBe(200);
      const res = await page.request.get(`/api/decks/${a.deckId}/pptx`);
      expect(res.status()).toBe(404);
      expect(res.headers()["content-type"]).toContain("application/json");
      const body = await res.json();
      expect(body.error).toBe("Ce diaporama est introuvable.");
      expect(JSON.stringify(body)).not.toContain(SECRET_NAME);

      const missing = await page.request.get(`/api/decks/cm0000000000000000000000/pptx`);
      expect(missing.status()).toBe(404);
      const invalid = await page.request.get(`/api/decks/${encodeURIComponent("../../etc")}/pptx`);
      expect(invalid.status()).toBe(404);
    } finally {
      await a.close();
    }
  });

  test("sans session, l'export répond 401", async ({ browser, request }) => {
    const a = await ownerWithContent(browser);
    try {
      const res = await request.get(`/api/decks/${a.deckId}/pptx`);
      expect(res.status()).toBe(401);
    } finally {
      await a.close();
    }
  });
});

test.describe("9. Sécurité — en-têtes", () => {
  for (const path of ["/", "/connexion", "/api/decks/x/pptx"]) {
    test(`devrait poser CSP, X-Frame-Options et nosniff sur ${path}`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      const h = res.headers();
      expect(h["content-security-policy"], "CSP absente").toBeTruthy();
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["content-security-policy"]).toMatch(/default-src 'self'/);
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["x-powered-by"]).toBeUndefined();
    });
  }
});
