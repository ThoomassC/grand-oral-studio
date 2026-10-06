import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import type { Locator, Page } from "@playwright/test";
import { PREFERENCES_STORAGE_KEY } from "../src/components/preferences/preferences";

/**
 * Panneau « Réglages » de l'en-tête : réglages du site propres à l'appareil
 * (thème, taille du texte, animations), appliqués tout de suite, mémorisés
 * dans localStorage et posés sur <html> avant la première peinture.
 */

test.afterAll(async () => {
  await deleteE2eUsers();
});

const settingsButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Réglages" });
const themeToggle = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Mode sombre" });
const panel = (page: Page) => page.getByRole("dialog", { name: "Réglages" });
const html = (page: Page) => page.locator("html");

/**
 * L'interrupteur natif d'Opale est visuellement masqué (la piste dessinée le
 * remplace) : on clique son libellé, comme un utilisateur.
 */
async function clickReduceMotion(dialog: Locator) {
  await dialog.locator("label", { hasText: "Réduire les animations" }).click();
}

async function openSettings(page: Page) {
  await settingsButton(page).click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

test.describe("12. Réglages — panneau", () => {
  test("devrait s'ouvrir depuis l'en-tête, se fermer sur Échap et rendre le focus au bouton", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    const button = settingsButton(page);
    await expect(button).toHaveAttribute("aria-haspopup", "dialog");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    const dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(["Affichage", "Lisibilité", "Mouvements"]);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole("button", { name: "Fermer" }).click();
    await expect(button).toBeFocused();
  });

  test("devrait être proposé sans compte", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Grand", exact: true }).click();
    await expect(html(page)).toHaveAttribute("data-text-size", "large");
  });
});

test.describe("12. Réglages — affichage", () => {
  test("devrait synchroniser le thème du panneau avec le bouton soleil/lune et persister", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    let dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Sombre" }).click();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expect(dialog.getByRole("status")).toHaveText("Thème : Sombre. Enregistré.");
    await page.keyboard.press("Escape");
    await expect(themeToggle(page)).toHaveAttribute("aria-pressed", "true");

    await themeToggle(page).click();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    dialog = await openSettings(page);
    await expect(dialog.getByRole("button", { name: "Clair" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    await themeToggle(page).click();
    await page.reload();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expect(themeToggle(page)).toHaveAttribute("aria-pressed", "true");
    dialog = await openSettings(page);
    await expect(dialog.getByRole("button", { name: "Sombre" })).toHaveAttribute("aria-pressed", "true");
  });

  test("devrait suivre l'appareil avec « Système » (préférence sombre émulée)", async ({ page, account }) => {
    void account;
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/projets");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Clair" }).click();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    await dialog.getByRole("button", { name: "Système" }).click();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(themeToggle(page)).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(themeToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect((await openSettings(page)).getByRole("button", { name: "Système" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("12. Réglages — lisibilité et mouvements", () => {
  test("devrait agrandir le texte tout de suite et le garder après rechargement", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    await expect(html(page)).toHaveAttribute("data-text-size", "standard");
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("figure", { name: "Aperçu" })).toBeVisible();
    await dialog.getByRole("button", { name: "Très grand" }).click();
    await expect(html(page)).toHaveAttribute("data-text-size", "xlarge");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20px");
    await expect(dialog.getByRole("status")).toHaveText("Taille du texte : Très grand. Enregistré.");

    await page.reload();
    await expect(html(page)).toHaveAttribute("data-text-size", "xlarge");
    await expect((await openSettings(page)).getByRole("button", { name: "Très grand" })).toHaveAttribute("aria-pressed", "true");
  });

  test("devrait couper les transitions avec « Réduire les animations » et le garder après rechargement", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    const duration = () =>
      page.evaluate(() => {
        const el = document.querySelector(".header-control__caret") ?? document.querySelector(".header-control");
        return el ? parseFloat(getComputedStyle(el).transitionDuration) : Number.NaN;
      });
    expect(await duration()).toBeGreaterThan(0.01);

    const dialog = await openSettings(page);
    const toggle = dialog.getByRole("switch", { name: "Réduire les animations" });
    await expect(toggle).not.toBeChecked();
    await clickReduceMotion(dialog);
    await expect(toggle).toBeChecked();
    await expect(html(page)).toHaveAttribute("data-motion", "reduced");
    expect(await duration()).toBeLessThan(0.001);

    await page.reload();
    await expect(html(page)).toHaveAttribute("data-motion", "reduced");
    expect(await duration()).toBeLessThan(0.001);
    await expect((await openSettings(page)).getByRole("switch", { name: "Réduire les animations" })).toBeChecked();
  });

  test("devrait tout rétablir par défaut", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Sombre" }).click();
    await dialog.getByRole("button", { name: "Grand", exact: true }).click();
    await clickReduceMotion(dialog);
    await expect(dialog.getByRole("switch", { name: "Réduire les animations" })).toBeChecked();

    const reset = dialog.getByRole("button", { name: "Rétablir les réglages par défaut" });
    await reset.click();
    await expect(dialog.getByRole("status")).toHaveText("Réglages par défaut rétablis.");
    await expect(reset).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Système" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("switch", { name: "Réduire les animations" })).not.toBeChecked();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    await expect(html(page)).toHaveAttribute("data-text-size", "standard");
    await expect(html(page)).toHaveAttribute("data-motion", "system");

    await page.reload();
    await expect(html(page)).toHaveAttribute("data-text-size", "standard");
    await expect(html(page)).toHaveAttribute("data-theme", "light");
  });

  test("devrait suivre un changement fait dans un autre onglet", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    const other = await page.context().newPage();
    await other.goto("/projets");
    await expect(html(other)).toHaveAttribute("data-text-size", "standard");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Très grand" }).click();
    await expect(html(other)).toHaveAttribute("data-text-size", "xlarge");
    await other.close();
  });
});

test.describe("12. Réglages — pas de flash", () => {
  test("devrait poser les attributs avant le corps de la page, donc avant la première peinture", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    const dialog = await openSettings(page);
    await dialog.getByRole("button", { name: "Très grand" }).click();
    await clickReduceMotion(dialog);
    await expect(dialog.getByRole("switch", { name: "Réduire les animations" })).toBeChecked();

    // Relevé fait dès que <body> apparaît, bien avant le chargement des scripts de Next et l'hydratation.
    await page.addInitScript(() => {
      const record = () => {
        const root = document.documentElement;
        (window as unknown as { __atBody: unknown }).__atBody = {
          textSize: root.getAttribute("data-text-size"),
          motion: root.getAttribute("data-motion"),
        };
      };
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        record();
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    const atBody = await page.evaluate(() => (window as unknown as { __atBody: unknown }).__atBody);
    expect(atBody).toEqual({ textSize: "xlarge", motion: "reduced" });
  });

  test("devrait livrer le script des réglages dans le <head> du HTML serveur", async ({ page }) => {
    const res = await page.request.get("/");
    const body = await res.text();
    const head = body.slice(0, body.indexOf("</head>"));
    expect(head).toContain(PREFERENCES_STORAGE_KEY);
    expect(head).toContain("data-text-size");
  });

  test("devrait tolérer une valeur corrompue dans le stockage", async ({ page }) => {
    await page.addInitScript((key) => window.localStorage.setItem(key, "{corrompu"), PREFERENCES_STORAGE_KEY);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(html(page)).toHaveAttribute("data-text-size", "standard");
    await expect(html(page)).toHaveAttribute("data-motion", "system");
    expect(errors).toEqual([]);
  });
});

test.describe("12. Réglages — ancienne adresse", () => {
  test("devrait mener /parametres à la page Configuration IA", async ({ page, account }) => {
    void account;
    await page.goto("/parametres");
    await expect(page).toHaveURL(`${BASE_URL}/configuration-ia`);
    await expect(page.getByRole("main").getByRole("heading", { name: "Configuration IA", level: 1 })).toBeVisible();
  });
});
