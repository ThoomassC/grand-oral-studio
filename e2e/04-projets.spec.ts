import { test, expect, BASE_URL, expectNoHorizontalScroll } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList, openNewProjectDialog, projectRowAction, waitForHydration } from "./support/app";

test.afterAll(async () => {
  await deleteE2eUsers();
});

test.describe("4. Projets — création et carte", () => {
  test("devrait afficher la liste vide pour un nouveau compte, avec un appel à créer le premier projet", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    await expect(page.getByText("Aucun projet pour l'instant")).toBeVisible();
    // Plus de formulaire latéral : la création passe par une modale.
    await expect(page.getByLabel("Nom du projet")).toHaveCount(0);
    const cta = page.getByRole("button", { name: "Créer mon premier projet" });
    await waitForHydration(cta);
    await cta.click();
    const modal = dialog(page, "Nouveau projet");
    await expect(modal.getByLabel("Nom du projet")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(cta).toBeFocused();
  });

  test("devrait ouvrir la modale « Nouveau projet » depuis l'en-tête, et la fermer par Annuler en rendant le focus", async ({
    page,
    account,
  }) => {
    void account;
    const modal = await openNewProjectDialog(page);
    await modal.getByLabel("Nom du projet").fill("Brouillon abandonné");
    await modal.getByRole("button", { name: "Annuler" }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByRole("main").getByRole("button", { name: "Nouveau projet" })).toBeFocused();
    await expect(page.getByText("Aucun projet pour l'instant")).toBeVisible();
  });

  for (const [label, value] of [
    ["vide", ""],
    ["d'un caractère", "A"],
    ["fait d'espaces", "    "],
  ] as const) {
    test(`devrait refuser un nom ${label}`, async ({ page, account }) => {
      void account;
      const modal = await openNewProjectDialog(page);
      await modal.getByLabel("Nom du projet").fill(value);
      await modal.getByRole("button", { name: "Créer le projet" }).click();
      await expect(modal.getByText("Le nom doit contenir entre 2 et 120 caractères.")).toBeVisible();
      await expect(modal.getByLabel("Nom du projet")).toHaveAttribute("aria-invalid", "true");
      await expect(modal.getByLabel("Nom du projet")).toBeFocused();
      await expect(modal).toBeVisible();
      await expect(page).toHaveURL(`${BASE_URL}/projets`);
    });
  }

  test("ne devrait créer qu'un projet sur un double clic", async ({ page, account }) => {
    void account;
    const modal = await openNewProjectDialog(page);
    await modal.getByLabel("Nom du projet").fill("Projet double clic");
    await modal.getByRole("button", { name: "Créer le projet" }).dblclick();
    await page.waitForURL(/\/projets\/[a-z0-9]+\/apparence$/);
    await page.goto("/projets");
    await expect(page.getByRole("main").getByRole("heading", { name: "Projet double clic", level: 3 })).toHaveCount(1);
  });

  test("devrait créer le projet sur l'étape Apparence puis le montrer en carte à 2/3 (apparence et trame par défaut) avec « Commencer le Jour J »", async ({
    page,
    account,
  }) => {
    void account;
    const id = await createProject(page, "Master Management 2027", "Grand oral de fin d'études");
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/apparence`);
    await expect(page.getByRole("heading", { name: "Master Management 2027", level: 1 })).toBeVisible();
    await expect(page.getByText("Préparation : 2/3 étapes")).toBeVisible();

    await page.goto("/projets");
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Master Management 2027" }) });
    await expect(card.getByRole("img", { name: "2 étapes faites sur 3" })).toBeVisible();
    await expect(card).toContainText("Grand oral de fin d'études");
    await expect(card).toContainText("Sujets :0");
    const resume = card.getByRole("link", { name: "Commencer le Jour J — Master Management 2027" });
    await expect(resume).toHaveAttribute("href", `/projets/${id}/jour-j`);
    await resume.click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/jour-j`);
  });

  test("devrait présenter les trois étapes Apparence, Trame, Jour J et ouvrir /projets/<id> sur l'Apparence", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Projet trois étapes");
    await page.goto(`/projets/${id}`);
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/apparence`);
    const steps = page.getByRole("navigation", { name: "Étapes du projet" }).getByRole("link");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Apparence");
    await expect(steps.nth(1)).toContainText("Trame");
    await expect(steps.nth(2)).toContainText("Jour J");
    await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toContainText("Étape 1 · Apparence");

    await steps.nth(1).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/trame`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Trame", level: 2 })).toBeVisible();
    const tabs = main.getByRole("navigation", { name: "Trame : diapos et sujets" });
    await tabs.getByRole("link", { name: /^Sujets/ }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/trame/sujets`);
    await expect(main.getByRole("heading", { name: "Sujets", level: 2 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toContainText("Étape 2 · Trame");
  });
});

test.describe("4. Projets — menu du projet", () => {
  test("devrait renommer le projet par la modale", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet à renommer");
    await page.getByRole("button", { name: "Paramètres du projet" }).click();
    await page.getByRole("menuitem", { name: "Renommer" }).click();
    const modal = dialog(page, "Renommer le projet");
    await expect(modal).toBeVisible();
    const field = modal.getByLabel("Nom du projet");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Projet à renommer");
    await field.fill("Projet renommé");
    await modal.getByRole("button", { name: "Enregistrer" }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByText("Projet renommé.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Projet renommé", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toContainText("Projet renommé");
  });

  test("devrait refuser un nom trop court dans la modale", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet nom court");
    await page.getByRole("button", { name: "Paramètres du projet" }).click();
    await page.getByRole("menuitem", { name: "Renommer" }).click();
    const modal = dialog(page, "Renommer le projet");
    await modal.getByLabel("Nom du projet").fill("X");
    await modal.getByRole("button", { name: "Enregistrer" }).click();
    await expect(modal.getByText("Le nom du projet doit faire au moins 2 caractères.")).toBeVisible();
    await expect(modal).toBeVisible();
  });

  test("devrait fermer la modale par Échap sans enregistrer et rendre le focus au menu", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet Échap");
    const trigger = page.getByRole("button", { name: "Paramètres du projet" });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Renommer" }).click();
    const modal = dialog(page, "Renommer le projet");
    await modal.getByLabel("Nom du projet").fill("Ne doit pas être enregistré");
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Projet Échap", level: 1 })).toBeVisible();
  });

  test("devrait modifier la description par la modale et la montrer sur la carte", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet description");
    await page.getByRole("button", { name: "Paramètres du projet" }).click();
    await page.getByRole("menuitem", { name: "Modifier la description" }).click();
    const modal = dialog(page, "Modifier la description");
    await modal.getByLabel(/^Description/).fill("Master 2 — jury de trois personnes");
    await modal.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Description enregistrée.")).toBeVisible();
    await page.goto("/projets");
    await expect(page.getByText("Master 2 — jury de trois personnes")).toBeVisible();
  });
});

test.describe("4. Projets — duplication et suppression", () => {
  test("devrait garder le bouton d'avancement et ouvrir le menu « ⋮ » au clavier, lisible à 375 px", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet au nom assez long pour tester le menu de la ligne sur mobile");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/projets");
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) });
    await expect(card.getByRole("link", { name: /^Commencer le Jour J/ })).toBeVisible();
    const trigger = card.getByRole("button", { name: /^Actions du projet / });
    const box = await trigger.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);

    await waitForHydration(trigger);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: /^Actions du projet / });
    await expect(menu.getByRole("menuitem")).toHaveText(["Dupliquer", "Supprimer"]);
    await expect(menu.getByRole("menuitem", { name: "Dupliquer" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("devrait dupliquer le projet en tête de liste", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet source");
    await page.goto("/projets");
    await projectRowAction(page, "Projet source", "Dupliquer");
    await expect(page.getByText("Copie de « Projet source » créée en tête de liste.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Actions du projet Projet source", exact: true })).toBeFocused();
    const titles = page.getByRole("region", { name: "Liste des projets" }).getByRole("heading", { level: 3 });
    await expect(titles).toHaveText(["Projet source (copie)", "Projet source"]);
    await expect(page.getByText("2 projets")).toBeVisible();
  });

  test("devrait recopier les sujets dans la copie du projet", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Source avec sujets");
    await importThemeList(page, id);
    await page.goto("/projets");
    await projectRowAction(page, "Source avec sujets", "Dupliquer");
    const copy = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Source avec sujets (copie)" }) });
    await expect(copy).toContainText("Sujets :3");
  });

  test("devrait bloquer la suppression tant que le nom recopié est faux, puis supprimer", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet à supprimer");
    await page.goto("/projets");
    await projectRowAction(page, "Projet à supprimer", "Supprimer");
    const modal = dialog(page, "Supprimer le projet ?");
    await expect(modal).toBeVisible();
    const input = modal.getByLabel("Recopiez « Projet à supprimer » pour confirmer");
    await expect(input).toBeFocused();
    const confirm = modal.getByRole("button", { name: "Supprimer définitivement" });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");

    await input.fill("Projet a supprimer");
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    const actions: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actions.push(r.url());
    });
    await confirm.click({ force: true }); // bouton aria-disabled : le clic doit rester sans effet
    await input.press("Enter");
    await expect(modal.getByText("Recopiez exactement « Projet à supprimer » pour confirmer.")).toBeVisible();
    expect(actions, "aucune suppression ne doit partir").toEqual([]);
    await expect(modal).toBeVisible();

    await input.fill("Projet à supprimer");
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    await confirm.click();
    await expect(modal).toBeHidden();
    await expect(page.getByText("Aucun projet pour l'instant")).toBeVisible();
  });

  test("devrait annuler la suppression par Échap", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet conservé");
    await page.goto("/projets");
    await projectRowAction(page, "Projet conservé", "Supprimer");
    await expect(dialog(page, "Supprimer le projet ?")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Supprimer le projet ?")).toBeHidden();
    await expect(page.getByRole("button", { name: "Actions du projet Projet conservé" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Projet conservé", level: 3 })).toBeVisible();
  });
});
