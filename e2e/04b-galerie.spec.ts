import { test, expect, expectNoHorizontalScroll } from "./support/fixtures";
import { createProject, openProjectStartMenu, waitForHydration } from "./support/app";
import { deleteE2eUsers } from "./support/db";

test.afterAll(async () => { await deleteE2eUsers(); });

test("galerie : recherche sans accents, tri et filtres combinés, avec retour à tous les projets", async ({ page, account }) => {
  void account;
  await createProject(page, "Alpha — transition énergétique", "Les nouveaux usages de l’énergie");
  await createProject(page, "Zèbre — cybersécurité");
  await page.goto("/projets");
  const gallery = page.getByRole("list", { name: "Galerie des projets" });
  await expect(gallery.getByRole("heading").first()).toHaveText("Zèbre — cybersécurité");
  await page.getByLabel("Trier les projets").selectOption("name");
  await expect(gallery.getByRole("heading").first()).toHaveText("Alpha — transition énergétique");
  const search = page.getByRole("searchbox", { name: "Rechercher un projet" });
  await waitForHydration(search);
  await search.fill("energie");
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Nombre de projets" })).toHaveText("1 projet sur 2");
  await page.getByRole("button", { name: "Prêts", exact: true }).click();
  await expect(page.getByText("Aucun projet trouvé")).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  await expect(search).toHaveValue("");
  await expect(gallery.getByRole("listitem")).toHaveCount(2);
  const cover = gallery.getByRole("link", { name: "Ouvrir le projet Alpha — transition énergétique" });
  await expect(cover.locator('[aria-hidden="true"]').first()).toBeVisible();
  await cover.click();
  await expect(page.getByRole("heading", { name: "Apparence", level: 2 })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`galerie à 320 px, ${scheme} : contrôles accessibles et animations réduites`, async ({ page, account }) => {
    void account;
    await createProject(page, "Une présentation avec un titre long pour vérifier les cartes sur mobile");
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/projets");
    await expectNoHorizontalScroll(page);
    const createButton = page.getByRole("button", { name: "Créer un projet", exact: true });
    expect((await createButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const filters = page.getByRole("group", { name: "Filtrer les projets" }).getByRole("button");
    for (const filter of await filters.all()) {
      const box = await filter.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    const cover = page.getByRole("link", { name: /^Ouvrir le projet/ });
    const slide = cover.locator("[aria-hidden=true]").first();
    await expect(slide).toBeVisible();
    const motion = await cover.locator(":scope > div").evaluate((element) => ({ transition: getComputedStyle(element).transitionDuration, transform: getComputedStyle(element).transform }));
    expect(Number.parseFloat(motion.transition)).toBeLessThanOrEqual(0.001);
    expect(motion.transform).toBe("none");
    const searchLayout = await page.getByRole("searchbox").evaluate((input) => {
      const icon = input.parentElement!.parentElement!.querySelector(".opale-icon svg")!;
      return { iconEnd: icon.getBoundingClientRect().right, textStart: input.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(input).paddingInlineStart) };
    });
    expect(searchLayout.iconEnd).toBeLessThan(searchLayout.textStart);
    const menu = await openProjectStartMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveCount(3);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Créer un projet", exact: true })).toBeFocused();
  });
}
