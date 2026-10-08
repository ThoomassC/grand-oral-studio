import type { Page } from "@playwright/test";
import { BASE_URL, expect, newUser, signUpViaApi, test, watchPage } from "./support/fixtures";
import { deleteE2eUsers, query } from "./support/db";
import { createProject, importThemeList, waitForHydration } from "./support/app";
import { SUBJECTS, generateDeck } from "./support/parcours";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const PROBLEM = "La cybersécurité des PME peut-elle reposer sur la seule sensibilisation des salariés ?";

/** Deck du moteur démo (compte neuf, AI_PROVIDER=mock) sur un projet au sujet Cybersécurité (notes chiffrées). */
async function setupDeck(page: Page, name: string): Promise<{ programId: string; deckId: string }> {
  const programId = await createProject(page, name);
  await importThemeList(page, programId, SUBJECTS.cyber);
  const deckId = await generateDeck(page, programId, PROBLEM, "Cybersécurité");
  return { programId, deckId };
}

/** Ouvre une page d'entraînement depuis la barre « S'entraîner » de la page du diaporama. */
async function openFromDeck(page: Page, programId: string, deckId: string, link: string): Promise<void> {
  await page.goto(`/projets/${programId}/decks/${deckId}`);
  await page.getByRole("navigation", { name: "S'entraîner" }).getByRole("link", { name: link }).click();
}

const position = (page: Page) => page.getByRole("main").getByText(/^Diapo \d+ sur \d+$/);

test.describe("15. Répétition, questions du jury et fiches imprimables", () => {
  test("devrait chronométrer une répétition, afficher le bilan et l'enregistrer", async ({ page, account }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Répétition chronométrée");
    await openFromDeck(page, programId, deckId, "Répéter");
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks/${deckId}/repetition`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Répétition", level: 2, exact: true })).toBeVisible();
    await expect(main.getByText(/^Aucune répétition enregistrée pour ce diaporama/)).toBeVisible();

    const start = main.getByRole("button", { name: "Commencer la répétition" });
    await waitForHydration(start);
    await start.click();
    await expect(position(page)).toHaveText(/^Diapo 1 sur/);
    await page.waitForTimeout(1_200);
    await page.keyboard.press("ArrowRight");
    await expect(position(page)).toHaveText(/^Diapo 2 sur/);
    await page.keyboard.press("ArrowLeft");
    await expect(position(page)).toHaveText(/^Diapo 1 sur/);
    await main.getByRole("navigation", { name: "Diapos du diaporama" }).getByRole("button", { name: /^Diapo 3 :/ }).click();
    await expect(position(page)).toHaveText(/^Diapo 3 sur/);

    await main.getByRole("button", { name: "Terminer" }).click();
    await expect(main.getByRole("heading", { name: "Bilan de la répétition" })).toBeVisible();
    await expect(main.getByText("Répétition enregistrée.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("main").getByRole("heading", { name: "Vos dernières répétitions" })).toBeVisible();
    await expect(page.getByRole("main").getByText(/^Durée \d+:\d{2}$/)).toHaveCount(1);

    // Après rechargement, une nouvelle répétition repart de la première diapo.
    await expect(page.getByRole("main").getByRole("button", { name: "Commencer la répétition" })).toBeVisible();
    await expect(position(page)).toHaveText(/^Diapo 1 sur/);
  });

  test("devrait préparer les questions du jury, révéler une réponse et suivre ce qui reste à revoir", async ({ page, account }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Questions du jury");
    await openFromDeck(page, programId, deckId, "Questions du jury");
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks/${deckId}/questions`);
    const main = page.getByRole("main");
    await expect(main.getByText("Aucune question préparée pour ce diaporama.")).toBeVisible();

    const prepare = main.getByRole("button", { name: "Préparer les questions" });
    await waitForHydration(prepare);
    await prepare.click();
    await expect(main.getByText(/^\d+ questions préparées\.$/)).toBeVisible();
    const cards = main.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) });
    const total = await cards.count();
    expect(total).toBeGreaterThanOrEqual(8);
    await expect(main.getByText(`${total} à revoir`)).toBeVisible();

    const first = cards.first();
    await first.getByRole("button", { name: /^Voir les éléments de réponse/ }).click();
    await expect(first.getByRole("button", { name: /^Masquer les éléments de réponse/ })).toHaveAttribute("aria-expanded", "true");
    await first.getByRole("button", { name: /^Je sais répondre/ }).click();
    await expect(main.getByText(`${total - 1} à revoir`)).toBeVisible();

    await main.getByRole("checkbox", { name: "À revoir seulement" }).check();
    await expect(cards).toHaveCount(total - 1);

    // Le marquage est enregistré : il survit au rechargement.
    await page.reload();
    await expect(page.getByRole("main").getByText(`${total - 1} à revoir`)).toBeVisible();

    // Remplacer les questions passe par une confirmation.
    await page.getByRole("main").getByRole("button", { name: "Préparer de nouvelles questions" }).click();
    await expect(page.getByRole("dialog", { name: "Remplacer les questions ?" })).toBeVisible();
    await page.getByRole("dialog", { name: "Remplacer les questions ?" }).getByRole("button", { name: "Annuler" }).click();
  });

  test("un lecteur révise les questions sans pouvoir les préparer", async ({ page, account, browser }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Questions partagées");
    await openFromDeck(page, programId, deckId, "Questions du jury");
    const prepare = page.getByRole("main").getByRole("button", { name: "Préparer les questions" });
    await waitForHydration(prepare);
    await prepare.click();
    await expect(page.getByRole("main").getByText(/^\d+ questions préparées\.$/)).toBeVisible();

    const context = await browser.newContext({ baseURL: BASE_URL, locale: "fr-FR" });
    try {
      const reader = newUser("repetition-lecteur", "Lecteur E2E");
      await signUpViaApi(context.request, reader);
      const [row] = await query<{ id: string }>(`select "id" from "user" where "email" = $1`, [reader.email]);
      await query(`insert into "ProgramMember" ("programId", "userId", "role") values ($1, $2, 'VIEWER')`, [programId, row!.id]);
      const readerPage = await context.newPage();
      watchPage(readerPage, "15-repetition (lecteur)");

      await readerPage.goto(`/projets/${programId}/decks/${deckId}/questions`);
      const main = readerPage.getByRole("main");
      await expect(main.getByRole("heading", { name: "Questions du jury", level: 2 })).toBeVisible();
      await expect(main.getByRole("button", { name: /Préparer/ })).toHaveCount(0);
      const first = main.getByRole("listitem").filter({ has: readerPage.getByRole("heading", { level: 3 }) }).first();
      const known = first.getByRole("button", { name: /^Je sais répondre/ });
      await waitForHydration(known);
      await known.click();
      await expect(known).toHaveAttribute("aria-pressed", "true");

      // Statut propre à chacun : le propriétaire ne voit pas le marquage du lecteur.
      await page.reload();
      const ownerFirst = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) }).first();
      await expect(ownerFirst.getByRole("button", { name: /^Je sais répondre/ })).toHaveAttribute("aria-pressed", "false");

      // Le lecteur répète aussi.
      await readerPage.goto(`/projets/${programId}/decks/${deckId}/repetition`);
      await expect(readerPage.getByRole("main").getByRole("button", { name: "Commencer la répétition" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("devrait proposer les notes d'orateur et la fiche de révision à l'impression, sans l'habillage du site", async ({ page, account }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Fiches imprimables");

    await openFromDeck(page, programId, deckId, "Imprimer les notes");
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks/${deckId}/notes`);
    let main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Notes d'orateur", level: 2 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Plan", level: 3 })).toBeVisible();
    await expect(main.getByRole("button", { name: "Imprimer ou enregistrer en PDF" })).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toBeHidden();
    await expect(main.getByRole("button", { name: "Imprimer ou enregistrer en PDF" })).toBeHidden();
    await expect(main.getByRole("heading", { name: "Notes d'orateur", level: 2 })).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    const [theme] = await query<{ id: string }>(`select "id" from "Theme" where "programId" = $1`, [programId]);
    await page.goto(`/projets/${programId}/sujets/${theme!.id}/fiche`);
    main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Fiche de révision", level: 2 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Cybersécurité", level: 3 })).toBeVisible();
    await expect(main.getByText("60 % des PME touchées en 2025")).toBeVisible();
    await expect(main.getByText(/rançongiciel/)).toBeVisible();

    // Sujet d'un autre projet ou inconnu : 404.
    const res = await page.goto(`/projets/${programId}/sujets/inconnu/fiche`);
    expect(res?.status()).toBe(404);
  });
});
