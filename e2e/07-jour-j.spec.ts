import { test, expect } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList, openDayJourney, waitForHydration } from "./support/app";
import { SUBJECTS, chooseFreeWriter, generateDeck } from "./support/parcours";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const PROBLEM = "Comment protéger les données des entreprises face à la multiplication des attaques par rançongiciel ?";
const NONE_RADIO = "Sans sujet (problématique et trame seules)";

/** Nombre de sujets du projet : 0 (pas d'étape sujet), 1 (présélectionné) ou 3 (reconnaissance). */
type Subjects = 0 | 1 | 3;

/** Moteur « demo » : aucun choix enregistré, le serveur (AI_PROVIDER=mock) rédige en Démo. */
async function setup(page: Page, writer: "free" | "demo", subjects: Subjects, name: string): Promise<string> {
  if (writer === "free") await chooseFreeWriter(page);
  const id = await createProject(page, name);
  if (subjects === 1) await importThemeList(page, id, SUBJECTS.cyber);
  if (subjects === 3) await importThemeList(page, id, [SUBJECTS.cyber, SUBJECTS.digital, SUBJECTS.ai].join("\n"));
  await openDayJourney(page, id);
  return id;
}

function problemField(page: Page) {
  return page.getByRole("main").getByRole("textbox", { name: "Problématique tirée au sort" });
}

/** Dernière étape du parcours (« Le diaporama »). */
function lastStep(page: Page) {
  return page.getByRole("main").getByRole("region", { name: /Le diaporama/ });
}

function subjectHeading(page: Page) {
  return page.getByRole("main").getByRole("heading", { name: /Le sujet/, level: 3 });
}

test.describe("7. Jour J — saisie", () => {
  test("devrait refuser une problématique de moins de 10 caractères", async ({ page, account }) => {
    void account;
    await setup(page, "free", 0, "Jour J court");
    await problemField(page).fill("Court ?");
    await page.getByRole("main").getByRole("button", { name: "Continuer", exact: true }).click();
    await expect(page.getByRole("main").getByText("Saisissez la problématique complète (10 caractères au moins).")).toBeVisible();
    await expect(problemField(page)).toBeFocused();
    await expect(page.getByRole("main").getByRole("button", { name: "Générer le diaporama" })).toHaveCount(0);
  });

  test("devrait restaurer le brouillon après rechargement", async ({ page, account }) => {
    void account;
    await setup(page, "free", 3, "Jour J brouillon");
    const main = page.getByRole("main");
    await problemField(page).fill(PROBLEM);
    await main.getByLabel(/Sujet indiqué sur l'énoncé/).selectOption({ label: "Intelligence artificielle" });
    await page.reload();
    await expect(problemField(page)).toHaveValue(PROBLEM);
    await expect(main.getByLabel(/Sujet indiqué sur l'énoncé/).locator("option:checked")).toHaveText("Intelligence artificielle");
    await main.getByRole("button", { name: "Continuer avec ce sujet" }).click();
    await page.reload();
    await expect(page.getByRole("main").getByText(/pour le sujet Intelligence artificielle, à partir de la trame et des notes du sujet\./)).toBeVisible();
    await expect(page.getByRole("main").getByRole("blockquote")).toHaveText(PROBLEM);
  });

  test("devrait revenir à la saisie par « Modifier la problématique »", async ({ page, account }) => {
    void account;
    await setup(page, "free", 1, "Modifier problématique");
    await problemField(page).fill(PROBLEM);
    await page.getByRole("main").getByRole("button", { name: "Continuer", exact: true }).click();
    await page.getByRole("main").getByRole("button", { name: "Modifier la problématique" }).click();
    await expect(problemField(page)).toBeFocused();
    await expect(problemField(page)).toHaveValue(PROBLEM);
  });
});

test.describe("7. Jour J — projet sans sujet", () => {
  test("devrait annoncer problématique puis diaporama, sans étape sujet, et une rédaction Sans IA", async ({ page, account }) => {
    void account;
    await setup(page, "free", 0, "Jour J sans sujet");
    const main = page.getByRole("main");
    await expect(main.getByText("Recopiez la problématique, puis générez le diaporama.")).toBeVisible();
    await expect(main.getByText("Sans sujet : le diaporama part de la problématique et de la trame.")).toBeVisible();
    await expect(main.getByRole("link", { name: "Ajouter des sujets" })).toBeVisible();
    await expect(main.getByLabel(/Sujet indiqué sur l'énoncé/)).toHaveCount(0);

    await problemField(page).fill(PROBLEM);
    await main.getByRole("button", { name: "Continuer", exact: true }).click();
    await expect(subjectHeading(page)).toHaveCount(0);
    await expect(main.getByRole("radio")).toHaveCount(0);
    await expect(
      main.getByText("Diaporama à compléter, sans sujet : à partir de la problématique et de la trame."),
    ).toBeVisible();
    // Rappel en fin de parcours (le bandeau du haut l'annonce aussi, cf. « 7. Jour J — v1.2 »).
    await expect(lastStep(page).getByText("Rédaction : Sans IA")).toBeVisible();
    await expect(main.getByRole("button", { name: "Générer le diaporama" })).toBeFocused();
  });

  test("devrait générer un deck sans sujet, construit sans IA", async ({ page, account }) => {
    void account;
    const id = await setup(page, "free", 0, "Deck sans sujet");
    await generateDeck(page, id, PROBLEM, null);
    const main = page.getByRole("main");
    await expect(main.getByText("Diaporama final · Sans sujet")).toBeVisible();
    await expect(main.getByText(/^Votre diaporama est prêt : \d+ diapos à compléter\.$/)).toBeVisible();
    await expect(main.getByText("Sans IA", { exact: true })).toBeVisible();
    await expect(main.getByText(/à partir de votre trame et de la problématique : rien n'a été inventé\./)).toBeVisible();
    await expect(main.getByText("Sans IA · à compléter")).toBeVisible();
  });
});

test.describe("7. Jour J — projet à un sujet", () => {
  test("devrait présélectionner le seul sujet après « Continuer », sans reconnaissance", async ({ page, account }) => {
    void account;
    await setup(page, "free", 1, "Un seul sujet");
    const main = page.getByRole("main");
    await expect(main.getByText("Recopiez la problématique, vérifiez le sujet, générez le diaporama.")).toBeVisible();
    await expect(main.getByRole("button", { name: "Reconnaître le sujet" })).toHaveCount(0);
    await problemField(page).fill(PROBLEM);
    await main.getByRole("button", { name: "Continuer", exact: true }).click();
    await expect(subjectHeading(page)).toBeFocused();
    await expect(main.getByRole("radio", { name: "Cybersécurité Le seul sujet du projet" })).toBeChecked();
    await expect(main.getByRole("radio", { name: NONE_RADIO })).not.toBeChecked();
    await expect(
      main.getByText(/^Diaporama à compléter, construit avec vos notes, pour le sujet Cybersécurité, à partir de la trame et des notes du sujet\.$/),
    ).toBeVisible();
  });

  test("devrait permettre de continuer « Sans sujet » malgré le sujet du projet", async ({ page, account }) => {
    void account;
    await setup(page, "free", 1, "Un sujet, écarté");
    const main = page.getByRole("main");
    await problemField(page).fill(PROBLEM);
    await main.getByRole("button", { name: "Continuer", exact: true }).click();
    await main.getByRole("radio", { name: NONE_RADIO }).check();
    await expect(
      main.getByText("Diaporama à compléter, sans sujet : à partir de la problématique et de la trame."),
    ).toBeVisible();
  });

  test("devrait générer un deck avec le sujet, puis proposer le dernier diaporama au retour", async ({ page, account }) => {
    void account;
    const id = await setup(page, "free", 1, "Deck avec un sujet");
    await generateDeck(page, id, PROBLEM, "Cybersécurité");
    const main = page.getByRole("main");
    await expect(main.getByText("Diaporama final · Cybersécurité")).toBeVisible();
    await expect(main.getByText(/à partir de votre trame et des notes du sujet : rien n'a été inventé\./)).toBeVisible();
    await expect(main.getByRole("heading", { name: /\d+ diapos/, level: 2 })).toBeVisible();
    const deckPath = new URL(page.url()).pathname;

    await openDayJourney(page, id);
    await expect(main.getByText(/^Votre dernier diaporama \(« .+ », il y a moins d'une minute\) est prêt\.$/)).toBeVisible();
    // Brouillon effacé après génération.
    await expect(problemField(page)).toHaveValue("");
    await main.getByRole("link", { name: "Ouvrir le diaporama" }).click();
    await expect(page).toHaveURL(new RegExp(`${deckPath}$`));
    await expect(main.getByText(/^Votre diaporama est prêt/)).toHaveCount(0);
  });
});

test.describe("7. Jour J — projet à plusieurs sujets", () => {
  test("devrait reconnaître le sujet sans IA par mots-clés avec la rédaction Sans IA", async ({ page, account }) => {
    void account;
    await setup(page, "free", 3, "Reconnaissance sans IA");
    const main = page.getByRole("main");
    await problemField(page).fill(PROBLEM);
    await main.getByRole("button", { name: "Reconnaître le sujet" }).click();
    await expect(subjectHeading(page)).toBeFocused();
    await expect(main.getByText("Reconnaissance sans IA, par mots-clés")).toBeVisible();
    await expect(main.getByRole("radio", { name: /^Cybersécurité/ })).toBeChecked();
    await expect(main.getByRole("radio", { name: NONE_RADIO })).toBeVisible();
    await expect(main.getByText(/pour le sujet Cybersécurité, à partir de la trame et des notes du sujet\./)).toBeVisible();
  });

  test("devrait reconnaître le sujet avec le moteur démo (confiance affichée)", async ({ page, account }) => {
    void account;
    await setup(page, "demo", 3, "Reconnaissance démo");
    const main = page.getByRole("main");
    await problemField(page).fill(PROBLEM);
    await main.getByRole("button", { name: "Reconnaître le sujet" }).click();
    await expect(main.getByRole("radio", { name: /^Cybersécurité Confiance \d+ %/ })).toBeChecked();
    await expect(main.getByText("Reconnaissance sans IA, par mots-clés")).toHaveCount(0);
    await expect(main.getByText(/^Diaporama complet avec notes d'orateur pour le sujet Cybersécurité/)).toBeVisible();
    await expect(lastStep(page).getByText("Rédaction : Démo")).toBeVisible();
  });

  test("devrait permettre de choisir un autre sujet du projet", async ({ page, account }) => {
    void account;
    await setup(page, "free", 3, "Autre sujet");
    const main = page.getByRole("main");
    await problemField(page).fill(PROBLEM);
    await main.getByRole("button", { name: "Reconnaître le sujet" }).click();
    await main.getByRole("radio", { name: "Un autre sujet du projet" }).check();
    await main.getByRole("combobox", { name: "Sujet", exact: true }).selectOption({ label: "Intelligence artificielle" });
    await expect(main.getByText(/pour le sujet Intelligence artificielle, à partir de la trame et des notes du sujet\./)).toBeVisible();
  });

  test("devrait passer directement au diaporama avec le sujet indiqué sur l'énoncé, signalé par un badge", async ({ page, account }) => {
    void account;
    await setup(page, "free", 3, "Sujet indiqué");
    const main = page.getByRole("main");
    await problemField(page).fill(PROBLEM);
    await main.getByLabel(/Sujet indiqué sur l'énoncé/).selectOption({ label: "Transformation numérique" });
    await main.getByRole("button", { name: "Continuer avec ce sujet" }).click();
    await expect(main.getByRole("radio", { name: /^Transformation numérique/ })).toBeChecked();
    await expect(main.getByText("Indiqué sur l'énoncé", { exact: true })).toBeVisible();
    await expect(main.getByText(/pour le sujet Transformation numérique, à partir de la trame et des notes du sujet\./)).toBeVisible();
  });

  test("devrait vérifier le sujet indiqué avec l'IA : il passe en tête, badge « Indiqué sur l'énoncé »", async ({ page, account }) => {
    void account;
    await setup(page, "demo", 3, "Vérifier indiqué");
    const main = page.getByRole("main");
    await problemField(page).fill(PROBLEM);
    await main.getByLabel(/Sujet indiqué sur l'énoncé/).selectOption({ label: "Transformation numérique" });
    await main.getByRole("button", { name: "Reconnaître le sujet" }).click();
    await expect(main.getByText("Indiqué sur l'énoncé", { exact: true })).toBeVisible();
    await expect(main.getByRole("radio", { name: /^Transformation numérique/ })).toBeChecked();
    await expect(main.getByRole("radio", { name: /^Cybersécurité Confiance \d+ %/ })).toBeVisible();
  });
});

test.describe("7. Jour J — suppression d'un sujet qui a un deck", () => {
  test("devrait annoncer la suppression du diaporama et vider la liste des decks", async ({ page, account }) => {
    void account;
    const id = await setup(page, "free", 1, "Sujet avec deck");
    await generateDeck(page, id, PROBLEM, "Cybersécurité");
    await page.goto(`/projets/${id}/trame/sujets`);
    await page.getByRole("main").getByRole("button", { name: "Supprimer Cybersécurité" }).click();
    const modal = dialog(page, "Supprimer le sujet ?");
    await expect(modal).toContainText("Son diaporama du jour J sera aussi supprimé.");
    await modal.getByRole("button", { name: "Supprimer le sujet et son diaporama" }).click();
    await expect(modal).toBeHidden();
    await page.goto(`/projets/${id}/decks`);
    await expect(page.getByRole("main").getByText("Aucun diaporama pour l'instant")).toBeVisible();
  });
});

test.describe("7. Jour J — v1.2 : rédacteur, chronomètre, avant l'examen, entraînement", () => {
  test("devrait annoncer le rédacteur en haut de la page, avant la saisie, avec un lien « Changer »", async ({ page, account }) => {
    void account;
    await setup(page, "free", 0, "Bandeau rédacteur");
    const main = page.getByRole("main");
    await expect(main.getByText("Rédaction : Sans IA", { exact: true })).toBeVisible();
    await expect(main.getByText(/Sans IA : un diaporama à compléter, construit avec votre trame et vos notes\./)).toBeVisible();
    await expect(main.getByRole("link", { name: /^Changer/ }).first()).toHaveAttribute("href", "/configuration-ia");
  });

  test("devrait démarrer le chronomètre à la saisie de la problématique et le garder au rechargement", async ({ page, account }) => {
    void account;
    await setup(page, "free", 0, "Chrono réel");
    const main = page.getByRole("main");
    await expect(main.getByText("de préparation")).toBeVisible();
    await expect(main.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await problemField(page).fill(PROBLEM);
    await expect(main.getByText("restantes")).toBeVisible();
    await page.reload();
    await expect(main.getByText("restantes")).toBeVisible();
    await main.getByRole("button", { name: "Pause" }).click();
    await expect(main.getByText("en pause")).toBeVisible();
    await main.getByRole("button", { name: "Reprendre" }).click();
    await main.getByRole("button", { name: "Réinitialiser" }).click();
    await expect(main.getByText("de préparation")).toBeVisible();
  });

  test("devrait afficher la liste « Avant l'examen » le jour J, et pas à l'entraînement", async ({ page, account }) => {
    void account;
    // Nom de projet distinct du libellé cherché : le titre du projet est aussi dans <main>.
    const id = await setup(page, "free", 0, "Liste de vérification");
    const main = page.getByRole("main");
    await expect(main.getByText(/^Avant l'examen : \d+ points? à vérifier$/)).toBeVisible();
    await expect(main.getByText("Export essayé")).toBeVisible();
    await page.goto(`/projets/${id}/jour-j?mode=entrainement`);
    await expect(main.getByRole("heading", { name: "Entraînement", level: 2 })).toBeVisible();
    await expect(main.getByText(/^Avant l'examen/)).toHaveCount(0);
  });

  test("devrait générer un diaporama d'entraînement", async ({ page, account }) => {
    void account;
    const id = await setup(page, "free", 0, "Entraînement");
    await page.goto(`/projets/${id}/jour-j?mode=entrainement`);
    const main = page.getByRole("main");
    await waitForHydration(problemField(page));
    await expect(page).toHaveTitle(/Entraînement/);
    await problemField(page).fill(PROBLEM);
    await main.getByRole("button", { name: "Continuer", exact: true }).click();
    await main.getByRole("button", { name: "Générer le diaporama d'entraînement" }).click();
    await page.waitForURL(/\/decks\/[a-z0-9]+\?nouveau=1/, { timeout: 90_000 });
  });
});
