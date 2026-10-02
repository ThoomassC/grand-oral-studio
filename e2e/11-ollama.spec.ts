import { test, expect, OLLAMA_CONFIGURED, OLLAMA_SKIP_REASON } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, importThemeList, setEngine } from "./support/app";

/**
 * Un squelette réel avec Ollama (qwen2.5:14b) : lent par nature. Durée notée
 * en annotation ; conformité au gabarit par défaut (7 sections, 13 diapos
 * couverture comprise) vérifiée sur la page du squelette.
 */

test.afterAll(async () => {
  await deleteE2eUsers();
});

const MODEL = "qwen2.5:14b";
const SIX_MINUTES = 6 * 60_000;

test.describe("6. Squelettes — Ollama réel", () => {
  test.skip(!OLLAMA_CONFIGURED, OLLAMA_SKIP_REASON);

  test(`devrait générer un squelette avec ${MODEL} conforme au gabarit par défaut`, async ({ page, account }) => {
    void account;
    test.setTimeout(SIX_MINUTES + 60_000);
    await setEngine(page, "ollama", MODEL);
    const id = await createProject(page, "Squelette Ollama");
    await importThemeList(
      page,
      id,
      "Cybersécurité | Protection des systèmes et des données des organisations | attaque, rançongiciel, données, sécurité",
    );
    await page.goto(`/projets/${id}/squelettes`);
    const card = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Cybersécurité", level: 3 }) });

    const started = Date.now();
    await page.getByRole("main").getByRole("button", { name: "Générer le squelette Cybersécurité" }).click();
    await expect(card.getByText(/^(Généré|Erreur)$/)).toBeVisible({ timeout: SIX_MINUTES });
    const seconds = Math.round((Date.now() - started) / 1000);
    test.info().annotations.push({ type: "durée Ollama", description: `${seconds} s` });
    const errorText = await card.locator(".text-danger").allTextContents();
    expect(errorText, `échec de la génération Ollama après ${seconds} s`).toEqual([]);
    await expect(card.getByText("Généré", { exact: true })).toBeVisible();
    await expect(card.getByText("Modèle local")).toBeVisible();

    const warnings = await card.locator("details li").allTextContents();
    test.info().annotations.push({ type: "écarts au gabarit (carte)", description: warnings.join(" | ") || "aucun" });

    await page.getByRole("main").getByRole("link", { name: "Ouvrir le squelette Cybersécurité" }).click();
    const main = page.getByRole("main");
    await expect(main.getByText("Squelette · Cybersécurité")).toBeVisible();
    const deckIssues = (await main.locator(".bg-warning-soft").allTextContents()).join(" ").trim();
    const total = await main.getByRole("heading", { level: 2, name: /^\d+ diapos$/ }).textContent();
    test.info().annotations.push({ type: "deck Ollama", description: `${total} ; écarts : ${deckIssues || "aucun"}` });
    console.log(`[ollama] ${MODEL} : ${seconds} s ; carte : ${warnings.join(" | ") || "aucun écart"} ; deck : ${total} ; ${deckIssues || "aucun écart"}`);
    await expect(main.getByRole("heading", { level: 2, name: "13 diapos" })).toBeVisible();
    await expect(main.getByText(/écarts? au gabarit/)).toHaveCount(0);
  });
});
