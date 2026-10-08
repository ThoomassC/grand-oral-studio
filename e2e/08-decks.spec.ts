import fs from "node:fs";
import JSZip from "jszip";
import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList } from "./support/app";
import { SUBJECTS, chooseFreeWriter, generateDeck, seedLegacySkeleton } from "./support/parcours";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const PROBLEM = "L'intelligence artificielle peut-elle remplacer le jugement humain dans les décisions de recrutement ?";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Deck du moteur démo (compte neuf, AI_PROVIDER=mock) sur un projet à un sujet. */
async function setupDeck(page: Page, name: string): Promise<{ programId: string; deckId: string }> {
  const programId = await createProject(page, name);
  await importThemeList(page, programId, SUBJECTS.ai);
  const deckId = await generateDeck(page, programId, PROBLEM, "Intelligence artificielle");
  return { programId, deckId };
}

async function slideCount(page: Page): Promise<number> {
  const text = await page.getByRole("main").getByRole("heading", { level: 2, name: /^\d+ diapos$/ }).textContent();
  return Number(text?.match(/\d+/)?.[0]);
}

function deckItem(page: Page, linkName: string) {
  return page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("link", { name: linkName, exact: true }) });
}

function breadcrumb(page: Page) {
  return page.getByRole("navigation", { name: "Fil d'Ariane" });
}

test.describe("8. Decks — liste, ouverture, suppression", () => {
  test("devrait lister le deck sous « Diaporamas du jour J » avec son sujet et son moteur, et l'ouvrir", async ({ page, account }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Liste des decks");
    await page.goto(`/projets/${programId}/decks`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Diaporamas du jour J", level: 2 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Squelettes (version 1.0)" })).toHaveCount(0);
    const item = deckItem(page, PROBLEM);
    await expect(item).toContainText("Sujet : Intelligence artificielle");
    await expect(item.getByText("Démo")).toBeVisible();
    await expect(main.getByRole("link", { name: "Diaporamas : 1 diaporama" })).toBeVisible();
    await item.getByRole("link", { name: /^Ouvrir le diaporama / }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks/${deckId}`);
    await expect(main.getByText("Diaporama final · Intelligence artificielle")).toBeVisible();
  });

  test("devrait afficher le fil d'Ariane « Decks / {titre} » sur la page d'un deck", async ({ page, account }) => {
    void account;
    const { programId } = await setupDeck(page, "Fil d'Ariane du deck");
    // Titre rédigé par le moteur démo : lu sur la page (titre du deck, cible du focus à l'arrivée).
    const title = (await page.locator("#titre-deck").textContent())?.trim() ?? "";
    expect(title.length).toBeGreaterThan(0);
    await expect(breadcrumb(page)).toContainText(title);
    await breadcrumb(page).getByRole("link", { name: "Diaporamas", exact: true }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks`);
    await expect(page.getByRole("main").getByRole("heading", { name: "Diaporamas du jour J", level: 2 })).toBeVisible();
  });

  test("devrait lister un deck sans sujet « Sans sujet » avec le bandeau « Construit sans IA »", async ({ page, account }) => {
    void account;
    await chooseFreeWriter(page);
    const programId = await createProject(page, "Deck sans sujet");
    const deckId = await generateDeck(page, programId, PROBLEM, null);
    await expect(page.getByRole("main").getByText("Sans IA", { exact: true })).toBeVisible();
    await page.goto(`/projets/${programId}/decks`);
    const item = deckItem(page, PROBLEM);
    await expect(item).toContainText("Sujet : Sans sujet");
    await expect(item.getByText("Sans IA · à compléter")).toBeVisible();
    await page.goto(`/projets/${programId}/decks/${deckId}`);
    await expect(page.getByRole("main").getByText("Diaporama final · Sans sujet")).toBeVisible();
  });

  test("devrait supprimer un deck depuis la liste par la modale, puis annuler la suppression", async ({ page, account }) => {
    void account;
    const { programId } = await setupDeck(page, "Suppression liste");
    await page.goto(`/projets/${programId}/decks`);
    await page.getByRole("main").getByRole("button", { name: /^Supprimer le diaporama / }).click();
    const modal = dialog(page, "Supprimer le diaporama ?");
    await expect(modal).toContainText("Vous pourrez annuler pendant quelques secondes.");
    await modal.getByRole("button", { name: "Supprimer le diaporama" }).click();
    await expect(page.getByRole("main").getByText("Aucun diaporama pour l'instant")).toBeVisible();

    // Notification d'Opale (hors <main>) : « Annuler » pendant 10 s.
    await expect(page.getByText("Diaporama supprimé.")).toBeVisible();
    await page.getByRole("button", { name: /^Annuler la suppression du diaporama / }).click();
    await expect(page.getByText("Diaporama restauré.")).toBeVisible();
    await expect(deckItem(page, PROBLEM)).toBeVisible();
  });

  test("devrait supprimer un deck depuis sa page et revenir à la liste", async ({ page, account }) => {
    void account;
    const { programId } = await setupDeck(page, "Suppression page");
    await page.getByRole("main").getByRole("region", { name: "Supprimer ce diaporama" }).getByRole("button", { name: /^Supprimer le diaporama/ }).click();
    await dialog(page, "Supprimer le diaporama ?").getByRole("button", { name: "Supprimer le diaporama" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks`);
    await expect(page.getByRole("main").getByText("Aucun diaporama pour l'instant")).toBeVisible();
  });
});

test.describe("8. Decks — anciens squelettes (version 1.0)", () => {
  const SKELETON = "Squelette hérité de la 1.0";

  test("devrait lister l'ancien squelette à part, l'ouvrir en lecture et le supprimer", async ({ page, account }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Anciens squelettes");
    const skeletonId = await seedLegacySkeleton(deckId, SKELETON);

    await page.goto(`/projets/${programId}/decks`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Squelettes (version 1.0)", level: 2 })).toBeVisible();
    const item = deckItem(page, SKELETON);
    await expect(item).toContainText("Sujet : Intelligence artificielle");
    // Le squelette ne compte pas parmi les decks du jour J.
    await expect(main.getByRole("link", { name: "Diaporamas : 1 diaporama" })).toBeVisible();

    await item.getByRole("link", { name: `Ouvrir le squelette ${SKELETON}` }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks/${skeletonId}`);
    await expect(main.getByText("Squelette (version 1.0) · Intelligence artificielle")).toBeVisible();
    await expect(main.getByText("Ancien squelette", { exact: true })).toBeVisible();
    await expect(breadcrumb(page)).toContainText(SKELETON);
    await expect(breadcrumb(page).getByRole("link", { name: "Diaporamas", exact: true })).toBeVisible();

    await main.getByRole("region", { name: "Supprimer ce squelette" }).getByRole("button", { name: `Supprimer le diaporama ${SKELETON}` }).click();
    // Un ancien squelette ne passe pas par la corbeille : suppression définitive, sans annulation.
    await expect(dialog(page, "Supprimer le diaporama ?")).toContainText("Cette action est définitive.");
    await dialog(page, "Supprimer le diaporama ?").getByRole("button", { name: "Supprimer le diaporama" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${programId}/decks`);
    await expect(main.getByRole("heading", { name: "Squelettes (version 1.0)" })).toHaveCount(0);
    await expect(deckItem(page, PROBLEM)).toBeVisible();
  });
});

test.describe("8. Decks — écarts à la trame", () => {
  test("devrait signaler un écart quand la trame change après la génération", async ({ page, account }) => {
    void account;
    await chooseFreeWriter(page);
    const programId = await createProject(page, "Écarts à la trame");
    const deckId = await generateDeck(page, programId, PROBLEM, null);
    const main = page.getByRole("main");
    // Construit depuis la trame : aucun écart.
    await expect(main.getByRole("heading", { level: 2, name: /^\d+ diapos$/ })).toBeVisible();
    await expect(main.getByText(/écarts? à la trame/)).toHaveCount(0);

    await page.goto(`/projets/${programId}/trame`);
    const count = main.getByLabel("Nombre de diapos de la ligne 1");
    const before = Number(await count.inputValue());
    await count.fill(String(before + 1));
    await main.getByRole("button", { name: "Enregistrer la trame" }).click();
    await expect(main.getByText("Trame enregistrée.")).toBeVisible();

    await page.goto(`/projets/${programId}/decks/${deckId}`);
    await expect(main.getByText("1 écart à la trame", { exact: true })).toBeVisible();
    await expect(main.getByText(new RegExp(`compte ${before} diapo\\(s\\) au lieu de ${before + 1}\\.$`))).toBeVisible();
    await expect(main.getByText("Ces écarts n'empêchent pas l'export.")).toBeVisible();
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

test.describe("8. Decks — structure du diaporama", () => {
  test("devrait insérer, déplacer et supprimer des diapos, et les garder après rechargement", async ({ page, account }) => {
    void account;
    await setupDeck(page, "Structure du deck");
    const main = page.getByRole("main");
    const initial = await slideCount(page);
    const third = (await main.locator("#diapo-3 h3").textContent())?.replace(/^\s*\d+\s*/, "").replace(/^Diapo 3 — /, "").trim() ?? "";

    // Insérer après la diapo 3 : la nouvelle diapo 4 s'ouvre en édition.
    await main.getByRole("button", { name: "Insérer une diapo après la diapo 3" }).click();
    await expect(main.getByRole("heading", { level: 2, name: `${initial + 1} diapos` })).toBeVisible();
    const title = main.getByRole("textbox", { name: "Titre", exact: true });
    await expect(title).toHaveValue("Nouvelle diapo");
    await title.fill("Diapo ajoutée");
    await main.getByRole("button", { name: "Enregistrer la diapo" }).click();
    await expect(main.getByRole("heading", { level: 3, name: "Diapo 4 — Diapo ajoutée" })).toBeVisible();

    // Descendre la diapo 3 : elle prend la place 4.
    await main.getByRole("button", { name: "Descendre la diapo 3" }).click();
    await expect(main.getByRole("heading", { level: 3, name: "Diapo 3 — Diapo ajoutée" })).toBeVisible();
    await expect(main.locator("#diapo-4")).toContainText(third);

    // La couverture ne se déplace ni ne se supprime.
    await expect(main.locator("#diapo-1").getByRole("button", { name: /^(Monter|Descendre|Supprimer)/ })).toHaveCount(0);

    // Supprimer la diapo ajoutée.
    await main.getByRole("button", { name: "Supprimer la diapo 3" }).click();
    await dialog(page, "Supprimer la diapo ?").getByRole("button", { name: "Supprimer la diapo" }).click();
    await expect(main.getByRole("heading", { level: 2, name: `${initial} diapos` })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("main").getByRole("heading", { level: 2, name: `${initial} diapos` })).toBeVisible();
    await expect(page.getByRole("main").getByText("Diapo ajoutée")).toHaveCount(0);
  });

  test("devrait régénérer une diapo avec l'IA du rédacteur (démo)", async ({ page, account }) => {
    void account;
    await setupDeck(page, "Régénérer une diapo");
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Régénérer la diapo 3 avec l'IA" }).click();
    await dialog(page, "Régénérer la diapo ?").getByRole("button", { name: "Régénérer la diapo" }).click();
    await expect(dialog(page, "Régénérer la diapo ?")).toHaveCount(0);
    // Le moteur démo réécrit le titre en « … (révisé) ».
    await expect(main.locator("#diapo-3 h3")).toContainText("(révisé)");
    await page.reload();
    await expect(page.getByRole("main").locator("#diapo-3 h3")).toContainText("(révisé)");
  });

  test("Sans IA : la régénération est masquée", async ({ page, account }) => {
    void account;
    await chooseFreeWriter(page);
    const programId = await createProject(page, "Régénération sans IA");
    await generateDeck(page, programId, PROBLEM, null);
    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: /Régénérer/ })).toHaveCount(0);
    await expect(main.getByText("Régénérer une diapo : disponible avec une rédaction IA (Rédaction IA).")).toBeVisible();
  });

  test("devrait dupliquer le diaporama et ouvrir la copie", async ({ page, account }) => {
    void account;
    const { programId, deckId } = await setupDeck(page, "Duplication du deck");
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Dupliquer le diaporama" }).click();
    await expect(page).toHaveURL(new RegExp(`/projets/${programId}/decks/(?!${deckId})[^/?]+\\?copie=1$`));
    await expect(main.getByText("Copie créée.")).toBeVisible();
    await page.goto(`/projets/${programId}/decks`);
    await expect(deckItem(page, PROBLEM)).toHaveCount(2);
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
    const prompt = panel.getByRole("textbox", { name: "Consignes pour Canva" });
    const value = await prompt.inputValue();
    expect(value.length).toBeGreaterThan(100);
    await panel.getByRole("button", { name: "Copier les consignes Canva" }).click();
    await expect(panel.getByText("Consignes copiées dans le presse-papiers.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
    await main.getByRole("button", { name: "Masquer l'import dans Canva" }).click();
    await expect(panel).toHaveCount(0);
  });
});
