import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, generateFinalDeck, generateMissingSkeletons, importThemeList, setEngine, type EngineChoice } from "./support/app";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const PROBLEM = "Comment protéger les données des entreprises face à la multiplication des attaques par rançongiciel ?";

async function setup(page: Page, engine: EngineChoice, name: string, skeletons = true): Promise<string> {
  await setEngine(page, engine);
  const id = await createProject(page, name);
  await importThemeList(page, id);
  if (skeletons) await generateMissingSkeletons(page, id);
  await page.goto(`/projets/${id}/jour-j`);
  return id;
}

function problemField(page: Page) {
  return page.getByRole("main").getByRole("textbox", { name: "Problématique tirée au sort" });
}

test.describe("7. Jour J — saisie", () => {
  test("devrait refuser une problématique de moins de 10 caractères", async ({ page, account }) => {
    void account;
    await setup(page, "free", "Jour J court", false);
    await problemField(page).fill("Trop court");
    await problemField(page).fill("Court ?");
    await page.getByRole("button", { name: "Reconnaître le thème" }).click();
    await expect(page.getByRole("main").getByText("Saisissez la problématique complète (10 caractères au moins).")).toBeVisible();
    await expect(problemField(page)).toBeFocused();
    await expect(page.getByRole("heading", { name: /Le thème/ })).toHaveCount(0);
  });

  test("devrait passer directement à l'étape 3 avec le thème indiqué", async ({ page, account }) => {
    void account;
    await setup(page, "free", "Jour J indiqué", false);
    await problemField(page).fill(PROBLEM);
    await page.getByRole("main").getByLabel(/Thème indiqué sur le sujet/).selectOption({ label: "Transformation numérique" });
    await page.getByRole("button", { name: "Continuer avec ce thème" }).click();
    await expect(page.getByRole("main").getByLabel("Thème indiqué sur votre sujet")).toHaveValue(/.+/);
    await expect(page.getByRole("main").getByLabel("Thème indiqué sur votre sujet").locator("option:checked")).toHaveText(/^Transformation numérique/);
    await expect(page.getByRole("main").getByText("Trame du diaporama, à compléter, pour le thème Transformation numérique.")).toBeVisible();
    await expect(page.getByRole("main").getByText("Ce thème n'a pas de squelette.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Générer le diaporama" })).toBeFocused();
  });

  test("devrait restaurer le brouillon après rechargement", async ({ page, account }) => {
    void account;
    await setup(page, "free", "Jour J brouillon", false);
    await problemField(page).fill(PROBLEM);
    await page.getByRole("main").getByLabel(/Thème indiqué sur le sujet/).selectOption({ label: "Intelligence artificielle" });
    await page.reload();
    await expect(problemField(page)).toHaveValue(PROBLEM);
    await expect(page.getByRole("main").getByLabel(/Thème indiqué sur le sujet/).locator("option:checked")).toHaveText("Intelligence artificielle");
    await page.getByRole("button", { name: "Continuer avec ce thème" }).click();
    await page.reload();
    await expect(page.getByRole("main").getByText("Trame du diaporama, à compléter, pour le thème Intelligence artificielle.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("blockquote")).toHaveText(PROBLEM);
  });
});

test.describe("7. Jour J — reconnaissance du thème", () => {
  test("devrait reconnaître le thème sans IA avec le moteur Gratuit", async ({ page, account }) => {
    void account;
    await setup(page, "free", "Reconnaissance gratuite");
    await problemField(page).fill(PROBLEM);
    await page.getByRole("button", { name: "Reconnaître le thème" }).click();
    await expect(page.getByRole("heading", { name: /Le thème/ })).toBeFocused();
    await expect(page.getByRole("main").getByText("Reconnaissance sans IA, par mots-clés")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Cybersécurité/ })).toBeChecked();
    await expect(page.getByRole("main").getByText(/pour le thème Cybersécurité, à partir de son squelette\./)).toBeVisible();
  });

  test("devrait reconnaître le thème avec le moteur démo (confiance affichée, pas de badge sans IA)", async ({ page, account }) => {
    void account;
    await setup(page, "claude", "Reconnaissance démo");
    await problemField(page).fill(PROBLEM);
    await page.getByRole("button", { name: "Reconnaître le thème" }).click();
    await expect(page.getByRole("radio", { name: /^Cybersécurité Confiance \d+ %/ })).toBeChecked();
    await expect(page.getByRole("main").getByText("Reconnaissance sans IA, par mots-clés")).toHaveCount(0);
    await expect(page.getByRole("main").getByText("Deck complet avec notes d'orateur pour le thème")).toBeVisible();
    await expect(page.getByRole("main").getByText("Rédaction : Démo (contenus factices)")).toBeVisible();
  });

  test("devrait permettre de choisir un autre thème du projet", async ({ page, account }) => {
    void account;
    await setup(page, "free", "Autre thème");
    await problemField(page).fill(PROBLEM);
    await page.getByRole("button", { name: "Reconnaître le thème" }).click();
    await page.getByRole("radio", { name: "Un autre thème du projet" }).check();
    await page.getByRole("combobox", { name: "Thème", exact: true }).selectOption({ label: "Intelligence artificielle" });
    await expect(page.getByRole("main").getByText(/pour le thème Intelligence artificielle, à partir de son squelette\./)).toBeVisible();
  });

  test("devrait vérifier le thème indiqué avec l'IA et le signaler « Indiqué sur votre sujet »", async ({ page, account }) => {
    void account;
    await setup(page, "claude", "Vérifier indiqué");
    await problemField(page).fill(PROBLEM);
    await page.getByRole("main").getByLabel(/Thème indiqué sur le sujet/).selectOption({ label: "Transformation numérique" });
    await page.getByRole("main").getByRole("button", { name: "Vérifier avec l'IA" }).click();
    await expect(page.getByRole("main").getByText("Indiqué sur votre sujet")).toBeVisible();
    // Le thème indiqué passe en tête et reste présélectionné ; le thème reconnu reste proposé avec sa confiance.
    await expect(page.getByRole("main").getByRole("radio", { name: /^Transformation numérique/ })).toBeChecked();
    await expect(page.getByRole("main").getByRole("radio", { name: /^Cybersécurité Confiance \d+ %/ })).toBeVisible();
  });

  test("devrait revenir à la saisie par « Modifier la problématique »", async ({ page, account }) => {
    void account;
    await setup(page, "free", "Modifier problématique", false);
    await problemField(page).fill(PROBLEM);
    await page.getByRole("button", { name: "Reconnaître le thème" }).click();
    await page.getByRole("button", { name: "Modifier la problématique" }).click();
    await expect(problemField(page)).toBeFocused();
    await expect(problemField(page)).toHaveValue(PROBLEM);
  });
});

for (const engine of ["free", "claude"] as const) {
  test.describe(`7. Jour J — génération (${engine === "free" ? "Gratuit" : "démo"})`, () => {
    test("devrait générer le deck, ouvrir sa page avec le bandeau, puis proposer le dernier diaporama au retour", async ({ page, account }) => {
      void account;
      const id = await setup(page, engine, `Génération ${engine}`);
      await problemField(page).fill(PROBLEM);
      await page.getByRole("button", { name: "Reconnaître le thème" }).click();
      await page.getByRole("button", { name: "Générer le diaporama" }).click();
      await page.waitForURL(new RegExp(`/projets/${id}/decks/[a-z0-9]+\\?nouveau=1$`), { timeout: 90_000 });
      const banner =
        engine === "free" ? /^Votre trame est prête : \d+ diapos à compléter\.$/ : /^Votre diaporama est prêt : \d+ diapos avec notes d'orateur\.$/;
      await expect(page.getByRole("main").getByText(banner)).toBeVisible();
      await expect(page.getByRole("heading", { name: /\d+ diapos/, level: 2 })).toBeVisible();
      await expect(page.getByRole("main").getByText("Deck final · Cybersécurité")).toBeVisible();
      const deckUrl = page.url().replace("?nouveau=1", "");

      await page.goto(`/projets/${id}/jour-j`);
      await expect(page.getByRole("main").getByText(/Votre dernier diaporama \(« .+ », il y a moins d'une minute\) est prêt\./)).toBeVisible();
      // Brouillon effacé après génération.
      await expect(problemField(page)).toHaveValue("");
      await page.getByRole("link", { name: "Ouvrir le diaporama" }).click();
      await expect(page).toHaveURL(deckUrl);
      await expect(page.getByRole("main").getByText(/Votre (trame|diaporama) est prête?/)).toHaveCount(0);
      await expect(page.getByRole("main").getByText(`Préparation : 3/3 étapes`)).toBeVisible();
      expect(deckUrl.startsWith(BASE_URL)).toBe(true);
    });
  });
}

test.describe("7. Jour J — projet sans thème", () => {
  test("devrait bloquer les étapes 2 et 3 avec une notice", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Projet vide");
    const steps = page.getByRole("navigation", { name: "Étapes du projet" });
    await expect(steps.getByRole("link", { name: "Étape 2 : Squelettes — bloquée : Ajoutez d'abord des thèmes" })).toBeVisible();
    await expect(steps.getByRole("link", { name: "Étape 3 : Jour J — bloquée : Ajoutez d'abord des thèmes" })).toBeVisible();
    // Cadenas : icône dans le lien d'étape bloquée.
    await expect(steps.getByRole("link", { name: /^Étape 3 : Jour J — bloquée/ }).locator("svg")).toBeVisible();

    await page.goto(`/projets/${id}/jour-j`);
    await expect(page.getByRole("main").getByText("Prérequis manquant")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aucun thème dans ce projet" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Problématique tirée au sort" })).toHaveCount(0);
    await page.goto(`/projets/${id}/squelettes`);
    await expect(page.getByRole("main").getByText("Prérequis manquant")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aucun thème à préparer" })).toBeVisible();
  });
});

test.describe("7. Jour J — suppression d'un thème qui a un deck", () => {
  test("devrait annoncer la suppression du diaporama et vider la liste des decks", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    const id = await createProject(page, "Thème avec deck");
    await importThemeList(page, id);
    await generateFinalDeck(page, id, PROBLEM, "Cybersécurité");
    await page.goto(`/projets/${id}`);
    await page.getByRole("main").getByRole("button", { name: "Supprimer Cybersécurité" }).click();
    const modal = dialog(page, "Supprimer le thème ?");
    await expect(modal).toContainText("son diaporama du jour J");
    await modal.getByRole("button", { name: "Supprimer le thème et son diaporama" }).click();
    await expect(modal).toBeHidden();
    await page.goto(`/projets/${id}/decks`);
    await expect(page.getByRole("main").getByText("Aucun deck pour l'instant")).toBeVisible();
  });
});

