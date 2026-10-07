import { test, expect, loggedInContext, expectNoHorizontalScroll } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, importThemeList } from "./support/app";
import { SUBJECTS, generateDeck, seedLegacySkeleton } from "./support/parcours";
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
  // Moteur démo (compte neuf, AI_PROVIDER=mock) ; deux sujets pour afficher l'étape « sujet » du Jour J.
  const id = await createProject(page, "Projet responsive avec un nom assez long pour tester le retour à la ligne");
  await importThemeList(page, id, [SUBJECTS.cyber, SUBJECTS.ai].join("\n"));
  const deckId = await generateDeck(
    page,
    id,
    "Comment protéger les données des entreprises face à la multiplication des attaques par rançongiciel ?",
    "Cybersécurité",
  );
  const skeletonId = await seedLegacySkeleton(deckId, "Squelette hérité de la 1.0 au titre assez long pour le retour à la ligne");
  Object.assign(paths, {
    Projets: "/projets",
    "Rédaction IA": "/configuration-ia",
    "Notes de version": "/notes-de-version",
    Profil: "/profil",
    "Étape 1 · Apparence": `/projets/${id}/apparence`,
    "Étape 2 · Trame": `/projets/${id}/trame`,
    "Trame · Sujets": `/projets/${id}/trame/sujets`,
    "Étape 3 · Jour J": `/projets/${id}/jour-j`,
    Diaporamas: `/projets/${id}/decks`,
    Diaporama: `/projets/${id}/decks/${deckId}`,
    "Squelette (version 1.0)": `/projets/${id}/decks/${skeletonId}`,
  });
});

test.afterAll(async () => {
  await context?.close();
  await deleteE2eUsers();
});

const PAGES = [
  "Projets",
  "Rédaction IA",
  "Notes de version",
  "Profil",
  "Étape 1 · Apparence",
  "Étape 2 · Trame",
  "Trame · Sujets",
  "Étape 3 · Jour J",
  "Diaporamas",
  "Diaporama",
  "Squelette (version 1.0)",
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

      test("pages publiques (accueil, connexion, inscription, notes de version) : pas de défilement horizontal", async ({ browser }) => {
        const anon = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
        const p = await anon.newPage();
        for (const path of ["/", "/connexion", "/inscription", "/notes-de-version"]) {
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

test.describe("10. Parcours d'un projet à 375 px", () => {
  test.beforeEach(async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
  });

  test("devrait montrer l'étape courante dans le fil compact et la barre « Étape suivante » de l'Apparence", async () => {
    await page.goto(paths["Étape 1 · Apparence"]!);
    const steps = page.getByRole("main").getByRole("navigation", { name: "Étapes du projet" });
    await expect(steps.getByRole("link", { name: /^Étape 1 : Apparence/ })).toHaveAttribute("aria-current", "step");
    await expect(steps.getByRole("link", { name: /^Étape 2 : Trame/ })).toBeAttached();
    await expect(steps.getByRole("link", { name: /^Étape 3 : Jour J/ })).toBeAttached();
    const bar = page.getByRole("main").getByRole("navigation", { name: "Étapes précédente et suivante" });
    await expect(bar.getByRole("link", { name: "Étape suivante : Trame" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Passer au Jour J" })).toBeVisible();
    await expect(bar.getByRole("link", { name: /^Étape précédente/ })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("devrait passer de la Trame aux Sujets (facultatifs) puis au Jour J par la barre du bas", async () => {
    await page.goto(paths["Étape 2 · Trame"]!);
    const bar = page.getByRole("main").getByRole("navigation", { name: "Étapes précédente et suivante" });
    await expect(bar.getByRole("link", { name: "Étape précédente : Apparence" })).toBeVisible();
    // Les sujets ne sont pas une étape : l'étape suivante de la Trame est le Jour J.
    await expect(bar.getByRole("link", { name: "Étape suivante : Jour J" })).toBeVisible();
    await bar.getByRole("link", { name: "Ajouter des sujets (facultatif)" }).click();
    await page.waitForURL(/\/trame\/sujets$/);
    await expect(page.getByRole("main").getByRole("heading", { name: "Sujets", level: 2 })).toBeVisible();
    // Depuis les Sujets, l'étape suivante est déjà le Jour J : pas de raccourci en double.
    await expect(bar.getByRole("link", { name: "Passer au Jour J" })).toHaveCount(0);
    await bar.getByRole("link", { name: "Étape suivante : Jour J" }).click();
    await page.waitForURL(/\/jour-j$/);
    const steps = page.getByRole("main").getByRole("navigation", { name: "Étapes du projet" });
    await expect(steps.getByRole("link", { name: /^Étape 3 : Jour J/ })).toHaveAttribute("aria-current", "step");
    await expect(bar.getByRole("link", { name: "Voir les diaporamas" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

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
