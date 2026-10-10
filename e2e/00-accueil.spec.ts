import { test, expect, BASE_URL, expectNoHorizontalScroll } from "./support/fixtures";
import { PREFERENCES_STORAGE_KEY, serializePreferences } from "../src/components/preferences/preferences";

test.describe("0. Accueil", () => {
  test("passe directement au contenu depuis le lien d’évitement au clavier", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Créer un compte", exact: true }).first()).toBeFocused();
  });

  test("présente le parcours puis ouvre l’inscription et la connexion", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Des idées claires.Un oral qui marque.");
    await page.getByRole("link", { name: "Découvrir le parcours" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/#parcours`);
    await expect(page.locator("#parcours")).toHaveCSS("opacity", "1");
    for (const name of ["Étape 1 : Apparence", "Étape 2 : Trame", "Étape 3 : Jour J"]) {
      await expect(page.getByRole("heading", { name, level: 3 })).toBeVisible();
    }
    await page.getByRole("banner").getByRole("link", { name: "Le jour J", exact: true }).click();
    await expect(page).toHaveURL(`${BASE_URL}/#jour-j`);
    await expect(page.locator("#jour-j")).toHaveCSS("opacity", "1");
    await page.getByRole("link", { name: "Créer un compte", exact: true }).first().click();
    await expect(page).toHaveURL(`${BASE_URL}/inscription`);
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Connexion", exact: true }).click();
    await expect(page).toHaveURL(`${BASE_URL}/connexion`);
    await expect(page.getByRole("heading", { name: "Heureux de vous revoir." })).toBeVisible();
  });

  test("ouvre les projets et rétablit leur en-tête pour un compte connecté", async ({ page, account }) => {
    void account;
    await page.goto("/");
    await expect(page).toHaveURL(`${BASE_URL}/projets`);
    await expect(page.getByRole("heading", { level: 1, name: "Projets" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Projets", exact: true })).toBeVisible();
  });

  test("rend tout le contenu immédiatement visible lorsque le système réduit les animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 }).locator("..")).toHaveCSS("animation-name", "none");
    await expect(page.locator("[data-reveal-state=waiting]")).toHaveCount(0);
    await page.getByRole("banner").getByRole("link", { name: "Connexion", exact: true }).click();
    await expect(page).toHaveURL(`${BASE_URL}/connexion`);
  });

  test("garde le parcours et les liens utilisables sans JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: BASE_URL });
    try {
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "Étape 3 : Jour J" })).toBeVisible();
      // Activation native au clavier : le lien ne dépend pas de l’hydratation React.
      await page.getByRole("link", { name: "Créer un compte", exact: true }).first().press("Enter");
      await expect(page).toHaveURL(`${BASE_URL}/inscription`);
    } finally {
      await context.close();
    }
  });

  test("montre les sections sans transition dès que le visiteur réduit les animations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#parcours")).toHaveCSS("opacity", "0");
    await page.getByRole("banner").getByRole("button", { name: "Réglages" }).click();
    const panel = page.getByRole("dialog", { name: "Réglages" });
    await panel.locator("label", { hasText: "Réduire les animations" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await expect(page.locator("#parcours")).toHaveCSS("opacity", "1");
    await expect(page.locator("#jour-j")).toHaveCSS("opacity", "1");
    const transitionMs = await page.locator("#parcours").evaluate((section) => {
      return Math.max(...getComputedStyle(section).transitionDuration.split(",").map((duration) => parseFloat(duration) * (duration.trim().endsWith("ms") ? 1 : 1000)));
    });
    expect(transitionMs).toBeLessThanOrEqual(1);
  });
});

for (const width of [320, 390, 768, 1366]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`accueil ${width} px, ${scheme}${width === 320 ? ", texte très grand" : ""} : aucun débordement ni chevauchement`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      if (width === 320) {
        await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
          key: PREFERENCES_STORAGE_KEY,
          value: serializePreferences({ textSize: "xlarge", motion: "reduced" }),
        });
      }
      await page.goto("/");
      await expectNoHorizontalScroll(page);
      await expect(page.getByRole("banner").getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", scheme === "dark" ? "true" : "false");
      const overlaps = await page.getByRole("banner").evaluate((header) => {
        const rects = [...header.querySelectorAll("a, button")].map((el) => ({ name: el.textContent?.trim() || el.getAttribute("aria-label"), rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.height > 0);
        return rects.flatMap((a, i) => rects.slice(i + 1).filter((b) => a.rect.left < b.rect.right - 1 && b.rect.left < a.rect.right - 1 && a.rect.top < b.rect.bottom - 1 && b.rect.top < a.rect.bottom - 1).map((b) => `${a.name} / ${b.name}`));
      });
      expect(overlaps).toEqual([]);
    });
  }
}
