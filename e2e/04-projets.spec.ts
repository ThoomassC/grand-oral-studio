import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList } from "./support/app";

test.afterAll(async () => {
  await deleteE2eUsers();
});

test.describe("4. Projets — création et carte", () => {
  test("devrait afficher la liste vide pour un nouveau compte", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    await expect(page.getByText("Aucun projet pour l'instant")).toBeVisible();
    await expect(page.getByLabel("Nom du projet")).toBeFocused();
  });

  for (const [label, value] of [
    ["vide", ""],
    ["d'un caractère", "A"],
    ["fait d'espaces", "    "],
  ] as const) {
    test(`devrait refuser un nom ${label}`, async ({ page, account }) => {
      void account;
      await page.goto("/projets");
      await page.getByLabel("Nom du projet").fill(value);
      await page.getByRole("button", { name: "Créer le projet" }).click();
      await expect(page.getByText("Le nom doit contenir entre 2 et 120 caractères.")).toBeVisible();
      await expect(page.getByLabel("Nom du projet")).toHaveAttribute("aria-invalid", "true");
      await expect(page).toHaveURL(`${BASE_URL}/projets`);
    });
  }

  test("ne devrait créer qu'un projet sur un double clic", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    await page.getByLabel("Nom du projet").fill("Projet double clic");
    await page.getByRole("button", { name: "Créer le projet" }).dblclick();
    await page.waitForURL(/\/projets\/[a-z0-9]+$/);
    await page.goto("/projets");
    await expect(page.getByRole("main").getByRole("heading", { name: "Projet double clic", level: 3 })).toHaveCount(1);
  });

  test("devrait créer le projet puis le montrer en carte à 0/3 avec « Reprendre »", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Master Management 2027", "Grand oral de fin d'études");
    await expect(page.getByRole("heading", { name: "Master Management 2027", level: 1 })).toBeVisible();
    await expect(page.getByText("Préparation : 0/3 étapes")).toBeVisible();

    await page.goto("/projets");
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Master Management 2027" }) });
    await expect(card.getByRole("img", { name: "0 étape faite sur 3" })).toBeVisible();
    await expect(card).toContainText("Grand oral de fin d'études");
    const resume = card.getByRole("link", { name: "Reprendre : Préparer — Master Management 2027" });
    await expect(resume).toHaveAttribute("href", `/projets/${id}`);
    await resume.click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}`);
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
  test("devrait dupliquer le projet en tête de liste", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet source");
    await page.goto("/projets");
    await page.getByRole("button", { name: "Dupliquer le projet Projet source" }).click();
    await expect(page.getByText("Copie de « Projet source » créée en tête de liste.")).toBeVisible();
    const titles = page.getByRole("region", { name: "Liste des projets" }).getByRole("heading", { level: 3 });
    await expect(titles).toHaveText(["Projet source (copie)", "Projet source"]);
    await expect(page.getByText("2 projets")).toBeVisible();
  });

  test("devrait recopier les thèmes dans la copie du projet", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Source avec thèmes");
    await importThemeList(page, id);
    await page.goto("/projets");
    await page.getByRole("button", { name: "Dupliquer le projet Source avec thèmes" }).click();
    const copy = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Source avec thèmes (copie)" }) });
    await expect(copy).toContainText("Thèmes :3");
  });

  test("devrait bloquer la suppression tant que le nom recopié est faux, puis supprimer", async ({ page, account }) => {
    void account;
    await createProject(page, "Projet à supprimer");
    await page.goto("/projets");
    await page.getByRole("button", { name: "Supprimer le projet Projet à supprimer" }).click();
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
    await page.getByRole("button", { name: "Supprimer le projet Projet conservé" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Supprimer le projet ?")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Projet conservé", level: 3 })).toBeVisible();
  });
});
