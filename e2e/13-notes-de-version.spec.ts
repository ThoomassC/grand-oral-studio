import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import type { Page } from "@playwright/test";

/**
 * Notes de version : page publique (hors matcher de src/proxy.ts), troisième
 * onglet de l'en-tête. Les versions sont lues dans src/domain/releases.ts, de la
 * plus récente à la plus ancienne.
 */

test.afterAll(async () => {
  await deleteE2eUsers();
});

const VERSIONS = ["1.1.0", "1.0.1", "1.0.0"];

function mainNav(page: Page) {
  return page.getByRole("banner").getByRole("navigation", { name: "Navigation principale" });
}

test.describe("13. Notes de version", () => {
  test("devrait être accessible sans compte, sans redirection vers la connexion", async ({ page }) => {
    const res = await page.goto("/notes-de-version");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(`${BASE_URL}/notes-de-version`);
    await expect(page.getByRole("main").getByRole("heading", { name: "Notes de version", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/Notes de version/);
  });

  test("devrait lister les versions 1.1.0, 1.0.1 et 1.0.0, de la plus récente à la plus ancienne", async ({ page }) => {
    await page.goto("/notes-de-version");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2 })).toHaveText(VERSIONS);
    const latest = main.getByRole("article", { name: "1.1.0" });
    await expect(latest.getByRole("heading", { name: "Ajouts", level: 3 })).toBeVisible();
    await expect(latest.getByRole("heading", { name: "Retraits", level: 3 })).toBeVisible();
    await expect(latest.getByRole("listitem").filter({ hasText: "L'onglet Notes de version." })).toBeVisible();
    await expect(main.getByRole("article", { name: "1.0.0" })).toContainText("Première version en ligne.");
    await expect(main.getByRole("article", { name: "1.0.0" }).locator("time")).toHaveAttribute("datetime", "2026-10-04");
  });

  test("devrait offrir le seul onglet « Notes de version » sans compte", async ({ page }) => {
    await page.goto("/");
    const nav = mainNav(page);
    await expect(nav.getByRole("link")).toHaveText(["Notes de version"]);
    await nav.getByRole("link", { name: "Notes de version" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/notes-de-version`);
    await expect(nav.getByRole("link", { name: "Notes de version" })).toHaveAttribute("aria-current", "page");
  });

  test("devrait être le troisième onglet de l'en-tête pour un compte connecté", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    const nav = mainNav(page);
    await expect(nav.getByRole("link")).toHaveText(["Projets", "Rédaction IA", "Notes de version"]);
    await nav.getByRole("link", { name: "Notes de version" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/notes-de-version`);
    await expect(nav.getByRole("link", { name: "Notes de version" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Projets" })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(VERSIONS);
  });
});
