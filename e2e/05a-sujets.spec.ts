import { test, expect } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList, waitForHydration } from "./support/app";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

/*
 * Étape 2 · Trame, onglet Sujets (facultatif) : saisie manuelle, notes, ordre,
 * suppression et import d'une liste au format « Nom | description | mots-clés | notes ».
 * Portée <main> : juste après une navigation, le streaming peut laisser une copie
 * masquée hors de <main>.
 */

function main(page: Page) {
  return page.getByRole("main");
}

function subjectList(page: Page) {
  return main(page).getByRole("list", { name: "Sujets du projet" });
}

function subjectTitles(page: Page) {
  return subjectList(page).getByRole("heading", { level: 3 });
}

function addPanel(page: Page) {
  return main(page).getByRole("region", { name: "Nouveau sujet", exact: true });
}

/** Crée un projet et ouvre son onglet Sujets, hydraté. Renvoie l'id du projet. */
async function openSubjects(page: Page, projectName: string): Promise<string> {
  const id = await createProject(page, projectName);
  await page.goto(`/projets/${id}/trame/sujets`);
  await expect(main(page).getByRole("heading", { name: "Sujets", level: 2 })).toBeVisible();
  await waitForHydration(main(page).getByRole("button", { name: "Ajouter un sujet" }));
  return id;
}

async function openAddPanel(page: Page) {
  const panel = addPanel(page);
  if (!(await panel.isVisible())) await main(page).getByRole("button", { name: "Ajouter un sujet" }).click();
  await expect(panel.getByLabel("Nom du sujet")).toBeFocused();
  return panel;
}

async function addSubject(page: Page, name: string, keywords: string[] = [], description = "") {
  const panel = await openAddPanel(page);
  await panel.getByLabel("Nom du sujet").fill(name);
  if (description) await panel.getByLabel(/^Description/).fill(description);
  const kw = panel.getByRole("textbox", { name: /^Mots-clés/ });
  for (const k of keywords) {
    await kw.fill(k);
    await kw.press("Enter");
  }
  await panel.getByRole("button", { name: "Ajouter le sujet" }).click();
  await expect(panel.getByText("Sujet ajouté. Vous pouvez en saisir un autre.")).toBeVisible();
}

async function openListImport(page: Page) {
  await main(page).getByRole("button", { name: "Importer une liste" }).click();
  const panel = main(page).getByRole("region", { name: "Importer des sujets", exact: true });
  await expect(panel.getByLabel("Liste des sujets")).toBeFocused();
  return panel;
}

test.describe("5. Trame — sujets saisis à la main", () => {
  test("devrait présenter l'onglet Sujets comme facultatif quand le projet n'a aucun sujet", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Sujets facultatifs");
    const tabs = main(page).getByRole("navigation", { name: "Trame : diapos et sujets" });
    await expect(tabs.getByRole("link", { name: "Sujets : Facultatif" })).toHaveAttribute("aria-current", "page");
    await expect(main(page).getByText("Aucun sujet", { exact: true })).toBeVisible();
  });

  test("devrait ajouter un sujet avec mots-clés (Entrée et virgule) et vider le formulaire", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Sujets manuels");
    const panel = await openAddPanel(page);
    await panel.getByLabel("Nom du sujet").fill("Cybersécurité");
    const kw = panel.getByRole("textbox", { name: /^Mots-clés/ });
    await kw.fill("attaque");
    await kw.press("Enter");
    await kw.pressSequentially("données,");
    await kw.fill("ATTAQUE");
    await kw.press("Enter"); // doublon insensible à la casse : ignoré
    await expect(panel.getByRole("list", { name: "Mots-clés" }).getByRole("listitem")).toHaveText(["attaque", "données"]);
    await expect(panel.getByText("Validez chaque mot-clé avec Entrée ou une virgule (2/30).")).toBeVisible();
    await panel.getByRole("button", { name: "Ajouter le sujet" }).click();
    await expect(panel.getByText("Sujet ajouté. Vous pouvez en saisir un autre.")).toBeVisible();
    await expect(panel.getByLabel("Nom du sujet")).toHaveValue("");
    await expect(panel.getByLabel("Nom du sujet")).toBeFocused();

    const item = subjectList(page).getByRole("listitem").filter({ hasText: "Cybersécurité" }).first();
    await expect(item.getByRole("list", { name: "Mots-clés" })).toContainText("attaque");
    await expect(item).toContainText("Aucun diaporama du jour J");
    const tabs = main(page).getByRole("navigation", { name: "Trame : diapos et sujets" });
    await expect(tabs.getByRole("link", { name: "Sujets : 1 sujet" })).toBeVisible();
  });

  test("devrait enregistrer les notes du sujet, compter leurs caractères et les afficher dans la liste", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Notes de sujet");
    const panel = await openAddPanel(page);
    const notes = panel.getByLabel(/^Notes/);
    await expect(notes).toHaveAttribute("maxlength", "4000");
    await expect(panel.getByText(/^0 \/ 4\s000 caractères$/)).toBeVisible();
    await panel.getByLabel("Nom du sujet").fill("Transition énergétique");
    await notes.fill("42 % d'ENR en 2030");
    await expect(panel.getByText(/^18 \/ 4\s000 caractères$/)).toBeVisible();
    await panel.getByRole("button", { name: "Ajouter le sujet" }).click();
    await expect(panel.getByText("Sujet ajouté. Vous pouvez en saisir un autre.")).toBeVisible();

    await page.reload();
    const item = subjectList(page).getByRole("listitem").filter({ hasText: "Transition énergétique" }).first();
    await expect(item).toContainText("42 % d'ENR en 2030");
    await main(page).getByRole("button", { name: "Modifier Transition énergétique" }).click();
    const editor = main(page).getByRole("region", { name: "Modifier Transition énergétique" });
    await expect(editor.getByLabel(/^Notes/)).toHaveValue("42 % d'ENR en 2030");
  });

  test("ne devrait ajouter qu'un sujet sur un double clic", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Sujet double clic");
    const panel = await openAddPanel(page);
    await panel.getByLabel("Nom du sujet").fill("Unique");
    await panel.getByRole("button", { name: "Ajouter le sujet" }).dblclick();
    await expect(panel.getByText("Sujet ajouté. Vous pouvez en saisir un autre.")).toBeVisible();
    await page.reload();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Unique"]);
  });

  test("devrait refuser un sujet sans nom", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Sujet sans nom");
    const panel = await openAddPanel(page);
    await panel.getByRole("button", { name: "Ajouter le sujet" }).click();
    await expect(panel.getByLabel("Nom du sujet")).toHaveAttribute("aria-invalid", "true");
    await expect(panel.getByLabel("Nom du sujet")).toBeFocused();
    await expect(main(page).getByText("Aucun sujet", { exact: true })).toBeVisible();
  });

  test("devrait modifier un sujet puis annuler une édition par Échap", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Édition de sujet");
    await addSubject(page, "Sujet initial", ["un"]);
    await main(page).getByRole("button", { name: "Modifier Sujet initial" }).click();
    const editor = main(page).getByRole("region", { name: "Modifier Sujet initial" });
    await expect(editor.getByLabel("Nom du sujet")).toBeFocused();
    await editor.getByLabel("Nom du sujet").fill("Sujet renommé");
    await editor.getByLabel(/^Description/).fill("Nouvelle description");
    await editor.getByRole("button", { name: "Enregistrer le sujet" }).click();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Sujet renommé"]);
    await expect(main(page).getByRole("button", { name: "Modifier Sujet renommé" })).toBeFocused();
    await expect(subjectList(page)).toContainText("Nouvelle description");

    await main(page).getByRole("button", { name: "Modifier Sujet renommé" }).click();
    await main(page).getByRole("region", { name: "Modifier Sujet renommé" }).getByLabel("Nom du sujet").fill("Abandonné");
    await page.keyboard.press("Escape");
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Sujet renommé"]);
  });

  test("devrait réordonner les sujets et garder l'ordre après rechargement", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Ordre des sujets");
    await addSubject(page, "Alpha");
    await addSubject(page, "Bravo");
    await addSubject(page, "Charlie");
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Alpha", "Sujet 2 : Bravo", "Sujet 3 : Charlie"]);
    await expect(main(page).getByRole("button", { name: "Monter Alpha" })).toBeDisabled();
    await expect(main(page).getByRole("button", { name: "Descendre Charlie" })).toBeDisabled();

    await main(page).getByRole("button", { name: "Descendre Alpha" }).click();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Bravo", "Sujet 2 : Alpha", "Sujet 3 : Charlie"]);
    await main(page).getByRole("button", { name: "Monter Charlie" }).click();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Bravo", "Sujet 2 : Charlie", "Sujet 3 : Alpha"]);
    await expect(main(page).getByText("« Charlie » déplacé en position 2 sur 3.")).toBeAttached();
    // Le rechargement attend la fin de l'enregistrement (avant, la garde « non enregistré » l'aurait retenu).
    await expect(main(page).getByRole("status").filter({ hasText: "Ordre enregistré." })).toBeVisible();
    await page.reload();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Bravo", "Sujet 2 : Charlie", "Sujet 3 : Alpha"]);
  });

  test("devrait supprimer un sujet par la modale, et l'annuler par Échap", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Suppression de sujet");
    await addSubject(page, "À garder");
    await addSubject(page, "À supprimer");
    await main(page).getByRole("button", { name: "Supprimer À supprimer" }).click();
    const modal = dialog(page, "Supprimer le sujet ?");
    await expect(modal).toContainText("Supprimer le sujet « À supprimer » ? Cette action est définitive.");
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(subjectTitles(page)).toHaveCount(2);

    await main(page).getByRole("button", { name: "Supprimer À supprimer" }).click();
    await modal.getByRole("button", { name: "Supprimer le sujet" }).click();
    await expect(modal).toBeHidden();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : À garder"]);
    await page.reload();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : À garder"]);
  });
});

test.describe("5. Trame — import d'une liste de sujets", () => {
  test("devrait importer trois sujets au format pipe avec description et mots-clés", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Import pipe");
    await importThemeList(page, id);
    await expect(main(page).getByText("3 sujets créés.")).toBeVisible();
    await expect(subjectTitles(page)).toHaveText([
      "Sujet 1 : Cybersécurité",
      "Sujet 2 : Transformation numérique",
      "Sujet 3 : Intelligence artificielle",
    ]);
    const cyber = subjectList(page).getByRole("listitem").filter({ hasText: "Protection des systèmes et des données" });
    await expect(cyber.getByRole("list", { name: "Mots-clés" }).getByRole("listitem")).toHaveText([
      "attaque",
      "rançongiciel",
      "données",
      "sécurité",
      "piratage",
    ]);
    await expect(main(page).getByRole("link", { name: "Passer au Jour J", exact: true })).toHaveAttribute(
      "href",
      `/projets/${id}/jour-j`,
    );
  });

  test("devrait lire la 4e colonne comme les notes du sujet", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Import avec notes");
    await importThemeList(page, id, "Économie circulaire | Réemploi et recyclage | déchets, ressources | 30 % de déchets recyclés en 2024");
    await expect(main(page).getByText("1 sujet créé.")).toBeVisible();
    const item = subjectList(page).getByRole("listitem").filter({ hasText: "Économie circulaire" }).first();
    await expect(item).toContainText("30 % de déchets recyclés en 2024");
  });

  test("devrait refuser tout l'import et citer les lignes invalides", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Import invalide");
    const panel = await openListImport(page);
    const text = ["Valide | ok", "# commentaire ignoré", "a|b|c|d|e", ` | description sans nom`, `${"N".repeat(130)}`].join("\n");
    await panel.getByLabel("Liste des sujets").fill(text);
    await panel.getByRole("button", { name: "Importer les sujets" }).click();
    const alert = panel.getByRole("alert").filter({ hasText: "Aucun sujet n'a été importé." });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Ligne 3 : Trop de séparateurs « | » (4 colonnes au plus).");
    await expect(alert).toContainText("Ligne 4 : nom");
    await expect(alert).toContainText("Ligne 5 : nom");
    await expect(panel.getByLabel("Liste des sujets")).toHaveValue(text);
    await expect(main(page).getByText("Aucun sujet", { exact: true })).toBeVisible();
  });

  test("devrait signaler un doublon au sein du texte (casse et accents ignorés)", async ({ page, account }) => {
    void account;
    await openSubjects(page, "Doublon interne");
    const panel = await openListImport(page);
    await panel.getByLabel("Liste des sujets").fill("Économie\neconomie");
    await panel.getByRole("button", { name: "Importer les sujets" }).click();
    await expect(panel.getByRole("alert").filter({ hasText: "Ligne 2 : Doublon du sujet de la ligne 1." })).toBeVisible();
  });

  test("devrait ignorer les sujets déjà présents lors d'un second import", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Second import");
    await importThemeList(page, id, "Cybersécurité\nIntelligence artificielle");
    const panel = main(page).getByRole("region", { name: "Importer des sujets", exact: true });
    await panel.getByLabel("Liste des sujets").fill("cybersécurité\nÉcologie");
    await panel.getByRole("button", { name: "Importer les sujets" }).click();
    await expect(panel.getByText("1 sujet créé.")).toBeVisible();
    await expect(panel.getByText("Ignoré (déjà présent) : cybersécurité.")).toBeVisible();
    await expect(subjectTitles(page)).toHaveCount(3);
  });
});
