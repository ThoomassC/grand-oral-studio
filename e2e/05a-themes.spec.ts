import { test, expect } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList } from "./support/app";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

function themeList(page: Page) {
  return page.getByRole("list", { name: "Thèmes du projet" });
}

function themeTitles(page: Page) {
  return themeList(page).getByRole("heading", { level: 3 });
}

async function addTheme(page: Page, name: string, keywords: string[] = [], description = "") {
  const panel = page.getByRole("region", { name: "Nouveau thème" });
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Ajouter un thème" }).click();
  await panel.getByLabel("Nom du thème").fill(name);
  if (description) await panel.getByLabel(/^Description/).fill(description);
  const kw = panel.getByRole("textbox", { name: /^Mots-clés/ });
  for (const k of keywords) {
    await kw.fill(k);
    await kw.press("Enter");
  }
  await panel.getByRole("button", { name: "Ajouter le thème" }).click();
  await expect(panel.getByText("Thème ajouté. Vous pouvez en saisir un autre.")).toBeVisible();
}

test.describe("5. Préparer — thèmes manuels", () => {
  test("devrait ajouter un thème avec mots-clés (Entrée et virgule) et vider le formulaire", async ({ page, account }) => {
    void account;
    await createProject(page, "Thèmes manuels");
    await page.getByRole("button", { name: "Ajouter un thème" }).click();
    const panel = page.getByRole("region", { name: "Nouveau thème" });
    await panel.getByLabel("Nom du thème").fill("Cybersécurité");
    const kw = panel.getByRole("textbox", { name: /^Mots-clés/ });
    await kw.fill("attaque");
    await kw.press("Enter");
    await kw.pressSequentially("données,");
    await kw.fill("ATTAQUE");
    await kw.press("Enter"); // doublon insensible à la casse : ignoré
    await expect(panel.getByRole("list", { name: "Mots-clés" }).getByRole("listitem")).toHaveText(["attaque", "données"]);
    await expect(panel.getByText("Validez chaque mot-clé avec Entrée ou une virgule (2/30).")).toBeVisible();
    await panel.getByRole("button", { name: "Ajouter le thème" }).click();
    await expect(panel.getByText("Thème ajouté. Vous pouvez en saisir un autre.")).toBeVisible();
    await expect(panel.getByLabel("Nom du thème")).toHaveValue("");
    await expect(panel.getByLabel("Nom du thème")).toBeFocused();

    const item = themeList(page).getByRole("listitem").filter({ hasText: "Cybersécurité" }).first();
    await expect(item.getByRole("list", { name: "Mots-clés" })).toContainText("attaque");
    await expect(item).toContainText("Squelette : à générer");
    await expect(page.getByRole("link", { name: /^Thèmes : 1 thème/ })).toBeVisible();
  });

  test("ne devrait ajouter qu'un thème sur un double clic", async ({ page, account }) => {
    void account;
    await createProject(page, "Thème double clic");
    await page.getByRole("button", { name: "Ajouter un thème" }).click();
    const panel = page.getByRole("region", { name: "Nouveau thème" });
    await panel.getByLabel("Nom du thème").fill("Unique");
    await panel.getByRole("button", { name: "Ajouter le thème" }).dblclick();
    await expect(panel.getByText("Thème ajouté. Vous pouvez en saisir un autre.")).toBeVisible();
    await page.reload();
    await expect(themeTitles(page)).toHaveText(["Thème 1 : Unique"]);
  });

  test("devrait refuser un thème sans nom", async ({ page, account }) => {
    void account;
    await createProject(page, "Thème sans nom");
    await page.getByRole("button", { name: "Ajouter un thème" }).click();
    const panel = page.getByRole("region", { name: "Nouveau thème" });
    await panel.getByRole("button", { name: "Ajouter le thème" }).click();
    await expect(panel.getByLabel("Nom du thème")).toHaveAttribute("aria-invalid", "true");
    await expect(panel.getByLabel("Nom du thème")).toBeFocused();
    await expect(page.getByText("Aucun thème", { exact: true })).toBeVisible();
  });

  test("devrait modifier un thème puis annuler une édition par Échap", async ({ page, account }) => {
    void account;
    await createProject(page, "Édition de thème");
    await addTheme(page, "Thème initial", ["un"]);
    await page.getByRole("button", { name: "Modifier Thème initial" }).click();
    const editor = page.getByRole("region", { name: "Modifier Thème initial" });
    await expect(editor.getByLabel("Nom du thème")).toBeFocused();
    await editor.getByLabel("Nom du thème").fill("Thème renommé");
    await editor.getByLabel(/^Description/).fill("Nouvelle description");
    await editor.getByRole("button", { name: "Enregistrer le thème" }).click();
    await expect(themeTitles(page)).toHaveText(["Thème 1 : Thème renommé"]);
    await expect(page.getByRole("button", { name: "Modifier Thème renommé" })).toBeFocused();
    await expect(themeList(page)).toContainText("Nouvelle description");

    await page.getByRole("button", { name: "Modifier Thème renommé" }).click();
    await page.getByRole("region", { name: "Modifier Thème renommé" }).getByLabel("Nom du thème").fill("Abandonné");
    await page.keyboard.press("Escape");
    await expect(themeTitles(page)).toHaveText(["Thème 1 : Thème renommé"]);
  });

  test("devrait réordonner les thèmes et garder l'ordre après rechargement", async ({ page, account }) => {
    void account;
    await createProject(page, "Ordre des thèmes");
    await addTheme(page, "Alpha");
    await addTheme(page, "Bravo");
    await addTheme(page, "Charlie");
    await expect(themeTitles(page)).toHaveText(["Thème 1 : Alpha", "Thème 2 : Bravo", "Thème 3 : Charlie"]);
    await expect(page.getByRole("button", { name: "Monter Alpha" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Descendre Charlie" })).toBeDisabled();

    await page.getByRole("button", { name: "Descendre Alpha" }).click();
    await expect(themeTitles(page)).toHaveText(["Thème 1 : Bravo", "Thème 2 : Alpha", "Thème 3 : Charlie"]);
    await page.getByRole("button", { name: "Monter Charlie" }).click();
    await expect(themeTitles(page)).toHaveText(["Thème 1 : Bravo", "Thème 2 : Charlie", "Thème 3 : Alpha"]);
    await expect(page.getByText("« Charlie » déplacé en position 2 sur 3.")).toBeAttached();
    // Le rechargement attend la fin de l'enregistrement (avant, la garde « non enregistré » l'aurait retenu).
    await expect(page.getByRole("status").filter({ hasText: "Ordre enregistré." })).toBeVisible();
    await page.reload();
    await expect(themeTitles(page)).toHaveText(["Thème 1 : Bravo", "Thème 2 : Charlie", "Thème 3 : Alpha"]);
  });

  test("devrait supprimer un thème par la modale, et l'annuler par Échap", async ({ page, account }) => {
    void account;
    await createProject(page, "Suppression de thème");
    await addTheme(page, "À garder");
    await addTheme(page, "À supprimer");
    await page.getByRole("button", { name: "Supprimer À supprimer" }).click();
    const modal = dialog(page, "Supprimer le thème ?");
    await expect(modal).toContainText("Supprimer « À supprimer » ? Cette action est définitive.");
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(themeTitles(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Supprimer À supprimer" }).click();
    await modal.getByRole("button", { name: "Supprimer le thème" }).click();
    await expect(modal).toBeHidden();
    await expect(themeTitles(page)).toHaveText(["Thème 1 : À garder"]);
    await page.reload();
    await expect(themeTitles(page)).toHaveText(["Thème 1 : À garder"]);
  });
});

test.describe("5. Préparer — import d'une liste texte", () => {
  test("devrait importer trois thèmes au format pipe avec description et mots-clés", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Import pipe");
    await importThemeList(page, id);
    await expect(page.getByText("3 thèmes créés.")).toBeVisible();
    await expect(themeTitles(page)).toHaveText([
      "Thème 1 : Cybersécurité",
      "Thème 2 : Transformation numérique",
      "Thème 3 : Intelligence artificielle",
    ]);
    const cyber = themeList(page).getByRole("listitem").filter({ hasText: "Protection des systèmes et des données" });
    await expect(cyber.getByRole("list", { name: "Mots-clés" }).getByRole("listitem")).toHaveText([
      "attaque",
      "rançongiciel",
      "données",
      "sécurité",
      "piratage",
    ]);
    await expect(page.getByRole("link", { name: "Passer aux squelettes", exact: true }).first()).toBeVisible();
  });

  test("devrait refuser tout l'import et citer les lignes invalides", async ({ page, account }) => {
    void account;
    await createProject(page, "Import invalide");
    await page.getByRole("button", { name: "Importer une liste" }).click();
    const text = ["Valide | ok", "# commentaire ignoré", "a|b|c|d", ` | description sans nom`, `${"N".repeat(130)}`].join("\n");
    await page.getByLabel("Liste des thèmes").fill(text);
    await page.getByRole("button", { name: "Importer les thèmes" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Aucun thème n'a été importé." });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Ligne 3 : Trop de séparateurs « | » (3 colonnes au plus).");
    await expect(alert).toContainText("Ligne 4 : nom");
    await expect(alert).toContainText("Ligne 5 : nom");
    await expect(page.getByLabel("Liste des thèmes")).toHaveValue(text);
    await expect(page.getByText("Aucun thème", { exact: true })).toBeVisible();
  });

  test("devrait signaler un doublon au sein du texte (casse et accents ignorés)", async ({ page, account }) => {
    void account;
    await createProject(page, "Doublon interne");
    await page.getByRole("button", { name: "Importer une liste" }).click();
    await page.getByLabel("Liste des thèmes").fill("Économie\neconomie");
    await page.getByRole("button", { name: "Importer les thèmes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Ligne 2 : Doublon du thème de la ligne 1." })).toBeVisible();
  });

  test("devrait ignorer les thèmes déjà présents lors d'un second import", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Second import");
    await importThemeList(page, id, "Cybersécurité\nIntelligence artificielle");
    await page.getByLabel("Liste des thèmes").fill("cybersécurité\nÉcologie");
    await page.getByRole("button", { name: "Importer les thèmes" }).click();
    await expect(page.getByText("1 thème créé.")).toBeVisible();
    await expect(page.getByText("Ignoré (déjà présent) : cybersécurité.")).toBeVisible();
    await expect(themeTitles(page)).toHaveCount(3);
  });
});
