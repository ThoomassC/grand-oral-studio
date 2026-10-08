import { test, expect, OLLAMA_CONFIGURED, OLLAMA_SKIP_REASON } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, importThemeList, waitForHydration } from "./support/app";
import { generateDeck } from "./support/parcours";

/**
 * Un deck du jour J réel avec Ollama (qwen2.5:14b) : lent par nature. Durée
 * notée en annotation ; conformité à la trame par défaut (7 lignes, 13 diapos
 * couverture comprise) vérifiée sur la page du deck.
 */

test.afterAll(async () => {
  await deleteE2eUsers();
});

const MODEL = "qwen2.5:14b";
const SIX_MINUTES = 6 * 60_000;
const PROBLEM = "Comment protéger les données des entreprises face à la multiplication des attaques par rançongiciel ?";

test.describe("11. Jour J — Ollama réel", () => {
  test.skip(!OLLAMA_CONFIGURED, OLLAMA_SKIP_REASON);

  test(`devrait rédiger un deck avec ${MODEL} conforme à la trame par défaut`, async ({ page, account }) => {
    void account;
    test.setTimeout(SIX_MINUTES + 120_000);
    await page.goto("/configuration-ia");
    const settings = page.getByRole("main");
    const radio = settings.getByRole("radio", { name: "Modèle local (Ollama)", exact: true });
    await waitForHydration(radio);
    await radio.check();
    await settings.getByLabel("Modèle", { exact: true }).selectOption(MODEL);
    await settings.getByRole("button", { name: "Choisir ce modèle" }).click();
    await expect(settings.getByText(`Choix enregistré : Ollama · ${MODEL}.`)).toBeVisible();

    const id = await createProject(page, "Deck Ollama");
    await importThemeList(
      page,
      id,
      "Cybersécurité | Protection des systèmes et des données des organisations | attaque, rançongiciel, données, sécurité | 60 % des PME touchées en 2025",
    );

    const started = Date.now();
    await generateDeck(page, id, PROBLEM, "Cybersécurité", SIX_MINUTES);
    const seconds = Math.round((Date.now() - started) / 1000);
    test.info().annotations.push({ type: "durée Ollama", description: `${seconds} s` });

    const main = page.getByRole("main");
    await expect(main.getByText("Diaporama final · Cybersécurité")).toBeVisible();
    await expect(main.getByText("Modèle local")).toBeVisible();
    const deckIssues = (await main.locator(".bg-warning-soft").allTextContents()).join(" ").trim();
    const total = await main.getByRole("heading", { level: 2, name: /^\d+ diapos$/ }).textContent();
    test.info().annotations.push({ type: "deck Ollama", description: `${total} ; écarts : ${deckIssues || "aucun"}` });
    console.log(`[ollama] ${MODEL} : ${seconds} s ; deck : ${total} ; ${deckIssues || "aucun écart"}`);
    await expect(main.getByRole("heading", { level: 2, name: "13 diapos" })).toBeVisible();
    await expect(main.getByText(/écarts? à la trame/)).toHaveCount(0);
  });
});
