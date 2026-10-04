import fs from "node:fs";
import JSZip from "jszip";
import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, generateFinalDeck, importThemeList, setEngine } from "./support/app";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const PROBLEM = "L'intelligence artificielle peut-elle remplacer le jugement humain dans les décisions de recrutement ?";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function setupDeck(page: Page, name: string): Promise<{ programId: string; deckId: string }> {
  await setEngine(page, "claude");
  const programId = await createProject(page, name);
  await importThemeList(page, programId);
  const deckId = await generateFinalDeck(page, programId, PROBLEM, "Intelligence artificielle");
  return { programId, deckId };
}

async function slideCount(page: Page): Promise<number> {
  const text = await page.getByRole("main").getByRole("heading", { level: 2, name: /^\d+ diapos$/ }).textContent();
  return Number(text?.match(/\d+/)?.[0]);
}

test.describe("8. Decks — liste, ouverture, suppression", () => {
  test("devrait lister le deck avec son thème et son moteur, et l'ouvrir", async ({ page, account }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Liste des decks");
    await page.goto(`/projets/${programId}/decks`);
    const main = page.getByRole("main");
    const item = main.getByRole("listitem").filter({ has: page.getByRole("link", { name: PROBLEM }) });
    await expect(item).toContainText("Thème : Intelligence artificielle");
    await expect(item.getByText("Démo")).toBeVisible();
    await expect(main.getByRole("link", { name: "Decks : 1 diaporama" })).toBeVisible();
    await item.getByRole("link", { name: /^Ouvrir le deck/ }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks/${deckId}`);
    await expect(main.getByText("Deck final · Intelligence artificielle")).toBeVisible();
  });

  test("devrait supprimer un deck depuis la liste par la modale", async ({ page, account }) => {
    void account;
    const { programId } = await setupDeck(page, "Suppression liste");
    await page.goto(`/projets/${programId}/decks`);
    await page.getByRole("main").getByRole("button", { name: /^Supprimer le deck / }).click();
    const modal = dialog(page, "Supprimer le deck ?");
    await expect(modal).toContainText("Cette action est définitive.");
    await modal.getByRole("button", { name: "Supprimer le deck" }).click();
    await expect(page.getByRole("main").getByText("Aucun deck pour l'instant")).toBeVisible();
  });

  test("devrait supprimer un deck depuis sa page et revenir à la liste", async ({ page, account }) => {
    void account;
    const { programId } = await setupDeck(page, "Suppression page");
    await page.getByRole("main").getByRole("region", { name: "Supprimer ce deck" }).getByRole("button", { name: /^Supprimer le deck/ }).click();
    await dialog(page, "Supprimer le deck ?").getByRole("button", { name: "Supprimer le deck" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks`);
    await expect(page.getByRole("main").getByText("Aucun deck pour l'instant")).toBeVisible();
  });
});

test.describe("8. Decks — édition et conflit", () => {
  test("devrait modifier une diapo du deck et la garder après rechargement", async ({ page, account }) => {
    void account;
    await setupDeck(page, "Édition deck");
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Modifier la diapo 3" }).click();
    await main.getByRole("textbox", { name: "Titre", exact: true }).fill("Diapo retouchée à la main");
    await main.getByRole("button", { name: "Enregistrer la diapo" }).click();
    await expect(main.getByRole("heading", { level: 3, name: "Diapo 3 — Diapo retouchée à la main" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("main").getByRole("heading", { level: 3, name: "Diapo 3 — Diapo retouchée à la main" })).toBeVisible();
  });

  test("devrait refuser le second enregistrement concurrent et proposer « Recharger »", async ({ page, account, context }) => {
    void account;
    await setupDeck(page, "Conflit d'édition");
    const url = page.url().replace("?nouveau=1", "");
    const other = await context.newPage();
    await other.goto(url);

    const a = page.getByRole("main");
    const b = other.getByRole("main");
    await a.getByRole("button", { name: "Modifier la diapo 2" }).click();
    await b.getByRole("button", { name: "Modifier la diapo 2" }).click();

    await a.getByRole("textbox", { name: "Titre", exact: true }).fill("Version de l'onglet A");
    await a.getByRole("button", { name: "Enregistrer la diapo" }).click();
    await expect(a.getByRole("heading", { level: 3, name: "Diapo 2 — Version de l'onglet A" })).toBeVisible();

    await b.getByRole("textbox", { name: "Titre", exact: true }).fill("Version de l'onglet B");
    await b.getByRole("button", { name: "Enregistrer la diapo" }).click();
    const reload = b.getByRole("button", { name: "Recharger le diaporama" });
    await expect(reload).toBeVisible();
    await expect(b.getByRole("textbox", { name: "Titre", exact: true })).toHaveValue("Version de l'onglet B");
    await reload.click();
    await expect(other.getByRole("main").getByRole("heading", { level: 3, name: "Diapo 2 — Version de l'onglet A" })).toBeVisible();
    await other.close();
  });
});

test.describe("8. Decks — export et Canva", () => {
  test("devrait télécharger un .pptx valide avec le bon nombre de diapos", async ({ page, account }) => {
    void account;
    await setupDeck(page, "Export pptx");
    const expected = await slideCount(page);
    expect(expected).toBeGreaterThan(1);

    const responsePromise = page.waitForResponse((r) => r.url().includes("/pptx"));
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("main").getByRole("button", { name: "Télécharger le .pptx" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe(PPTX_MIME);
    expect(response.headers()["content-disposition"]).toMatch(/^attachment;/);
    expect(response.headers()["cache-control"]).toContain("no-store");

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/);
    const file = test.info().outputPath("deck.pptx");
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const zip = await JSZip.loadAsync(bytes);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(expected);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    await expect(page.getByRole("main").getByText("Fichier .pptx téléchargé.")).toBeVisible();
  });

  test("devrait afficher les instructions Canva et copier le prompt", async ({ page, account, context }) => {
    void account;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
    await setupDeck(page, "Canva");
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Importer dans Canva" }).click();
    const panel = main.getByRole("region", { name: "Importer dans Canva" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("listitem")).toHaveCount(5);
    await expect(panel).toContainText("Importer un fichier");
    await expect(panel.getByRole("link", { name: /canva\.com/ })).toHaveAttribute("rel", "noopener noreferrer");
    const prompt = panel.getByRole("textbox", { name: "Prompt Canva" });
    const value = await prompt.inputValue();
    expect(value.length).toBeGreaterThan(100);
    await panel.getByRole("button", { name: "Copier le prompt Canva" }).click();
    await expect(panel.getByText("Prompt copié dans le presse-papiers.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
    await main.getByRole("button", { name: "Masquer l'import dans Canva" }).click();
    await expect(panel).toHaveCount(0);
  });
});
