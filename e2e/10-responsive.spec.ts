import { test, expect, loggedInContext, expectNoHorizontalScroll } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, generateFinalDeck, generateMissingSkeletons, importThemeList, setEngine } from "./support/app";
import type { BrowserContext, Page } from "@playwright/test";
import { PREFERENCES_STORAGE_KEY, serializePreferences } from "../src/components/preferences/preferences";

/**
 * Passe rapide à 375 et 320 px, en clair et en sombre : aucune page principale
 * ne doit défiler horizontalement. Un compte et un projet complet sont créés
 * une fois pour tout le fichier.
 */

let context: BrowserContext;
let page: Page;
const paths: Record<string, string> = {};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  ({ context, page } = await loggedInContext(browser, "responsive"));
  await setEngine(page, "claude");
  const id = await createProject(page, "Projet responsive avec un nom assez long pour tester le retour à la ligne");
  await importThemeList(page, id);
  await generateMissingSkeletons(page, id);
  await page.getByRole("link", { name: "Ouvrir le squelette Cybersécurité" }).click();
  await page.waitForURL(/\/squelettes\/[a-z0-9]+$/);
  const skeleton = new URL(page.url()).pathname;
  const deckId = await generateFinalDeck(
    page,
    id,
    "Comment protéger les données des entreprises face à la multiplication des attaques par rançongiciel ?",
    "Cybersécurité",
  );
  Object.assign(paths, {
    Projets: "/projets",
    "Configuration IA": "/configuration-ia",
    Profil: "/profil",
    "Étape 1 · Thèmes": `/projets/${id}`,
    Charte: `/projets/${id}/charte`,
    Gabarit: `/projets/${id}/gabarit`,
    Squelettes: `/projets/${id}/squelettes`,
    Squelette: skeleton,
    "Jour J": `/projets/${id}/jour-j`,
    Decks: `/projets/${id}/decks`,
    Deck: `/projets/${id}/decks/${deckId}`,
  });
});

test.afterAll(async () => {
  await context?.close();
  await deleteE2eUsers();
});

const PAGES = [
  "Projets",
  "Configuration IA",
  "Profil",
  "Étape 1 · Thèmes",
  "Charte",
  "Gabarit",
  "Squelettes",
  "Squelette",
  "Jour J",
  "Decks",
  "Deck",
] as const;

for (const width of [375, 320] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`10. Responsive ${width} px, ${scheme === "light" ? "clair" : "sombre"}`, () => {
      test.beforeEach(async () => {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme: scheme });
      });

      for (const name of PAGES) {
        test(`${name} : pas de défilement horizontal`, async () => {
          await page.goto(paths[name]!);
          await expect(page.getByRole("main")).toBeVisible();
          await expect(page.getByRole("banner").getByRole("button", { name: "Mode sombre" })).toHaveAttribute(
            "aria-pressed",
            scheme === "dark" ? "true" : "false",
          );
          await expectNoHorizontalScroll(page);
        });
      }

      test("pages publiques (accueil, connexion, inscription) : pas de défilement horizontal", async ({ browser }) => {
        const anon = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
        const p = await anon.newPage();
        for (const path of ["/", "/connexion", "/inscription"]) {
          await test.step(path, async () => {
            await p.goto(path);
            await expectNoHorizontalScroll(p, true);
          });
        }
        await anon.close();
      });
    });
  }
}

test.describe("10. Thème sombre — lisibilité de base", () => {
  test("devrait appliquer un fond sombre et un texte clair en mode sombre", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(paths["Deck"]!);
    const colors = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { bg: s.backgroundColor, fg: s.color };
    });
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number) as [number, number, number];
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    expect(lum(colors.bg), `fond ${colors.bg}`).toBeLessThan(0.3);
    expect(lum(colors.fg), `texte ${colors.fg}`).toBeGreaterThan(0.7);
  });
});

/** Réglage « Très grand » (panneau Réglages) : la racine passe à 125 %, la mise en page doit tenir. */
async function expectHeaderWithoutOverlap(p: Page): Promise<void> {
  const overlaps = await p.getByRole("banner").evaluate((banner) => {
    const rects = [...banner.querySelectorAll("a, button")].map((el) => ({ el: el.textContent?.trim() || el.getAttribute("aria-label"), r: el.getBoundingClientRect() }));
    const found: string[] = [];
    rects.forEach((a, i) =>
      rects.slice(i + 1).forEach((b) => {
        if (a.r.left < b.r.right - 1 && b.r.left < a.r.right - 1 && a.r.top < b.r.bottom - 1 && b.r.top < a.r.bottom - 1) found.push(`${a.el} / ${b.el}`);
      }),
    );
    return found;
  });
  expect(overlaps, "éléments de l'en-tête qui se chevauchent").toEqual([]);
}

const XLARGE = serializePreferences({ textSize: "xlarge", motion: "system" });

test.describe("10. Texte très grand, 375 px", () => {
  test.beforeAll(async () => {
    await page.goto("/projets");
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [PREFERENCES_STORAGE_KEY, XLARGE] as const);
  });

  test.afterAll(async () => {
    await page.evaluate((key) => window.localStorage.removeItem(key), PREFERENCES_STORAGE_KEY);
  });

  test.beforeEach(async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
  });

  for (const name of PAGES) {
    test(`${name} : pas de défilement horizontal`, async () => {
      await page.goto(paths[name]!);
      await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
      await expect(page.getByRole("main")).toBeVisible();
      const rootSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
      expect(rootSize).toBe("20px");
      await expectNoHorizontalScroll(page);
      await expectHeaderWithoutOverlap(page);
    });
  }

  test("pages publiques et panneau Réglages ouvert : pas de défilement horizontal", async ({ browser }) => {
    const anon = await browser.newContext({ viewport: { width: 375, height: 800 } });
    await anon.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [PREFERENCES_STORAGE_KEY, XLARGE] as const);
    const p = await anon.newPage();
    for (const path of ["/", "/connexion", "/inscription"]) {
      await test.step(path, async () => {
        await p.goto(path);
        await expect(p.locator("html")).toHaveAttribute("data-text-size", "xlarge");
        await expectNoHorizontalScroll(p);
        await expectHeaderWithoutOverlap(p);
      });
    }
    await p.getByRole("banner").getByRole("button", { name: "Réglages" }).click();
    const dialog = p.getByRole("dialog", { name: "Réglages" });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(p);
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375 + 0.5, `panneau hors écran : ${JSON.stringify(box)}`).toBe(true);
    await anon.close();
  });
});
