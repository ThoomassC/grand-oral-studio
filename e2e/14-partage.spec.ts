import type { Browser, BrowserContext, Page } from "@playwright/test";
import { BASE_URL, expect, newUser, signUpViaApi, test, watchPage, type TestUser } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, waitForHydration } from "./support/app";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const PROJECT = "Projet partagé BTS SIO";

interface Person {
  user: TestUser;
  page: Page;
  context: BrowserContext;
}

/** Compte neuf, au nom choisi, connecté dans son propre contexte navigateur. */
async function person(browser: Browser, zone: string, name: string): Promise<Person> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "fr-FR" });
  const user = newUser(zone, name);
  await signUpViaApi(context.request, user);
  const page = await context.newPage();
  watchPage(page, `14-partage (${name})`);
  return { user, page, context };
}

/** Ouvre la page Partage par le menu « Paramètres du projet » (engrenage). */
async function openShareFromMenu(page: Page, programId: string, entry: "Partager" | "Membres du projet"): Promise<void> {
  await page.goto(`/projets/${programId}/apparence`);
  const gear = page.getByRole("button", { name: "Paramètres du projet" });
  await waitForHydration(gear);
  await gear.click();
  await page.getByRole("menu", { name: "Paramètres du projet" }).getByRole("menuitem", { name: entry }).click();
  await page.waitForURL(`**/projets/${programId}/partage`);
  await expect(page.getByRole("main").getByRole("heading", { name: "Partage", level: 2 })).toBeVisible();
}

async function invite(page: Page, email: string, role: "Éditeur" | "Lecteur"): Promise<void> {
  const main = page.getByRole("main");
  const field = main.getByLabel("Adresse e-mail");
  await waitForHydration(field);
  await field.fill(email);
  await main.getByRole("radio", { name: new RegExp(`^${role}`) }).check();
  await main.getByRole("button", { name: "Ajouter au projet" }).click();
}

test.describe("14. Partage d'un projet entre collègues", () => {
  test("le propriétaire invite un éditeur et un lecteur ; chacun voit le projet avec son rôle", async ({ browser }) => {
    const owner = await person(browser, "partage-a", "Alice Martin");
    const editor = await person(browser, "partage-b", "Bruno Petit");
    const viewer = await person(browser, "partage-c", "Chloé Roy");
    try {
      const programId = await createProject(owner.page, PROJECT);
      await openShareFromMenu(owner.page, programId, "Partager");
      const main = owner.page.getByRole("main");

      // Adresse sans compte : message explicite sous le champ.
      await invite(owner.page, "personne-inconnue@example.test", "Lecteur");
      await expect(main.getByText(/votre collègue doit d'abord créer son compte/)).toBeVisible();

      await invite(owner.page, editor.user.email.toUpperCase(), "Éditeur");
      await expect(main.getByText("Bruno Petit a désormais accès au projet (rôle éditeur).")).toBeVisible();
      await invite(owner.page, viewer.user.email, "Lecteur");
      await expect(main.getByText("Chloé Roy a désormais accès au projet (rôle lecteur).")).toBeVisible();

      const list = main.getByRole("list", { name: "Membres du projet" });
      await expect(list.getByRole("listitem")).toHaveCount(3);
      await expect(list.getByLabel("Rôle de Bruno Petit")).toHaveValue("editor");
      await expect(list.getByLabel("Rôle de Chloé Roy")).toHaveValue("viewer");

      // Doublon : refusé sans changer le rôle.
      await invite(owner.page, viewer.user.email, "Éditeur");
      await expect(main.getByText("Cette personne est déjà membre du projet.")).toBeVisible();

      // L'éditeur voit le projet dans sa liste, avec le nom du propriétaire, et la liste des membres en lecture.
      await editor.page.goto("/projets");
      const card = editor.page.getByRole("main").getByRole("listitem").filter({ hasText: PROJECT });
      await expect(card.getByText("Partagé par Alice Martin")).toBeVisible();
      await openShareFromMenu(editor.page, programId, "Membres du projet");
      await expect(editor.page.getByRole("main").getByLabel("Adresse e-mail")).toHaveCount(0);
      await expect(editor.page.getByRole("main").getByText("Bruno Petit (vous)")).toBeVisible();

      // Le lecteur voit le bandeau « lecture seule ».
      await viewer.page.goto(`/projets/${programId}/apparence`);
      await expect(viewer.page.getByText("Projet partagé par Alice Martin · lecture seule")).toBeVisible();
      // Le lecteur n'a aucun bouton d'édition : apparence, menu du projet, trame, sujets, Jour J.
      const viewerMain = viewer.page.getByRole("main");
      await expect(viewerMain.getByRole("button", { name: "Enregistrer l'apparence" })).toHaveCount(0);
      await expect(viewerMain.getByRole("tab", { name: "Depuis vos consignes" })).toHaveCount(0);
      const gear = viewer.page.getByRole("button", { name: "Paramètres du projet" });
      await waitForHydration(gear);
      await gear.click();
      const menu = viewer.page.getByRole("menu", { name: "Paramètres du projet" });
      await expect(menu.getByRole("menuitem", { name: "Membres du projet" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Renommer" })).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: "Modifier la description" })).toHaveCount(0);
      await viewer.page.keyboard.press("Escape");
      await viewer.page.goto(`/projets/${programId}/trame`);
      await expect(viewerMain.getByRole("button", { name: "Enregistrer la trame" })).toHaveCount(0);
      await viewer.page.goto(`/projets/${programId}/trame/sujets`);
      await expect(viewerMain.getByRole("button", { name: "Ajouter un sujet" })).toHaveCount(0);
      await viewer.page.goto(`/projets/${programId}/jour-j`);
      await expect(viewerMain.getByText("Jour J en lecture seule")).toBeVisible();
      await expect(viewerMain.getByRole("textbox")).toHaveCount(0);
      await expect(viewerMain.getByRole("button", { name: /Générer|Continuer/ })).toHaveCount(0);
      // L'éditeur, non : bandeau absent, enregistrement possible.
      await editor.page.goto(`/projets/${programId}/apparence`);
      await expect(editor.page.getByText(/lecture seule/)).toHaveCount(0);
      await expect(editor.page.getByRole("main").getByRole("button", { name: "Enregistrer l'apparence" })).toBeVisible();
    } finally {
      await Promise.all([owner.context.close(), editor.context.close(), viewer.context.close()]);
    }
  });

  test("le propriétaire change un rôle et retire un membre, qui perd l'accès ; un membre peut quitter le projet", async ({ browser }) => {
    const owner = await person(browser, "partage-d", "Alice Martin");
    const editor = await person(browser, "partage-e", "Bruno Petit");
    const viewer = await person(browser, "partage-f", "Chloé Roy");
    const stranger = await person(browser, "partage-g", "Dan Inconnu");
    try {
      const programId = await createProject(owner.page, PROJECT);
      await openShareFromMenu(owner.page, programId, "Partager");
      await invite(owner.page, editor.user.email, "Lecteur");
      await expect(owner.page.getByRole("main").getByText(/Bruno Petit a désormais accès/)).toBeVisible();
      await invite(owner.page, viewer.user.email, "Lecteur");
      await expect(owner.page.getByRole("main").getByText(/Chloé Roy a désormais accès/)).toBeVisible();

      const main = owner.page.getByRole("main");
      await main.getByLabel("Rôle de Bruno Petit").selectOption("editor");
      await expect(main.getByText("Bruno Petit a désormais le rôle éditeur.")).toBeVisible();

      // Un inconnu ne voit rien, même la page Partage (404, sans fuite du nom).
      await stranger.page.goto(`/projets/${programId}/partage`);
      await expect(stranger.page.getByRole("main").getByRole("heading", { name: "Introuvable" })).toBeVisible();
      await expect(stranger.page.locator("body")).not.toContainText(PROJECT);

      // Retrait de Bruno, avec confirmation.
      await main.getByRole("button", { name: "Retirer Bruno Petit du projet" }).click();
      const dialog = owner.page.getByRole("dialog", { name: "Retirer ce membre ?" });
      await dialog.getByRole("button", { name: "Retirer" }).click();
      await expect(main.getByText("Bruno Petit n'a plus accès au projet.")).toBeVisible();
      await editor.page.goto(`/projets/${programId}/apparence`);
      await expect(editor.page.getByRole("main").getByRole("heading", { name: "Introuvable" })).toBeVisible();

      // Chloé quitte le projet elle-même.
      await openShareFromMenu(viewer.page, programId, "Membres du projet");
      await viewer.page.getByRole("main").getByRole("button", { name: "Quitter ce projet" }).click();
      await viewer.page.getByRole("dialog", { name: "Quitter ce projet ?" }).getByRole("button", { name: "Quitter le projet" }).click();
      await viewer.page.waitForURL("**/projets");
      await expect(viewer.page.getByRole("main").getByText(PROJECT)).toHaveCount(0);

      // Le propriétaire n'a plus de membre.
      await owner.page.reload();
      await expect(main.getByRole("list", { name: "Membres du projet" }).getByRole("listitem")).toHaveCount(1);
    } finally {
      await Promise.all([owner.context.close(), editor.context.close(), viewer.context.close(), stranger.context.close()]);
    }
  });

  test("la suppression du compte prévient que les projets partagés disparaîtront pour les collègues", async ({ browser }) => {
    const owner = await person(browser, "partage-h", "Alice Martin");
    const colleague = await person(browser, "partage-i", "Bruno Petit");
    try {
      const programId = await createProject(owner.page, PROJECT);
      await openShareFromMenu(owner.page, programId, "Partager");
      await invite(owner.page, colleague.user.email, "Lecteur");
      await expect(owner.page.getByRole("main").getByText(/Bruno Petit a désormais accès/)).toBeVisible();

      await owner.page.goto("/profil");
      const trigger = owner.page.getByRole("button", { name: "Supprimer mon compte" });
      await waitForHydration(trigger);
      await trigger.click();
      await expect(owner.page.getByRole("dialog", { name: "Supprimer votre compte ?" })).toContainText(
        "Les projets que vous partagez seront supprimés pour vos collègues aussi.",
      );
    } finally {
      await Promise.all([owner.context.close(), colleague.context.close()]);
    }
  });
});
