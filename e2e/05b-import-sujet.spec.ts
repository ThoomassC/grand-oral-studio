import { test, expect } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, setEngine } from "./support/app";
import { FILES, PPTX_THEME, SUBJECT_PROMPT } from "./support/files";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

function subject(page: Page) {
  return page.getByRole("region", { name: "Importer votre sujet" });
}

async function uploadSubjectFile(page: Page, file: string) {
  const panel = subject(page).getByRole("tabpanel", { name: "Depuis un fichier" });
  await panel.locator('input[type="file"]').setInputFiles(file);
}

async function analyzePrompt(page: Page, text: string) {
  await subject(page).getByRole("tab", { name: "Depuis un prompt" }).click();
  const panel = subject(page).getByRole("tabpanel", { name: "Depuis un prompt" });
  await panel.getByLabel("Votre sujet ou vos consignes").fill(text);
  await panel.getByRole("button", { name: "Analyser le prompt" }).click();
  const preview = panel.getByRole("region", { name: "Ce que nous avons trouvé" });
  await expect(preview).toBeVisible();
  return { panel, preview };
}

const hex = (h: string) => `#${h}`;

test.describe("5. Préparer — importer votre sujet depuis un fichier", () => {
  test("devrait lire couleurs et polices d'un .pptx, les appliquer, et passer la charte en « Personnalisé »", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Import pptx");
    await expect(page.getByRole("link", { name: "Charte : Par défaut" })).toBeVisible();
    await uploadSubjectFile(page, FILES.pptx);
    const preview = subject(page).getByRole("region", { name: "Charte proposée" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Lue dans le fichier Office, sans IA.");
    await expect(preview).toContainText(`Principale : ${hex(PPTX_THEME.accent1)}`);
    await expect(preview).toContainText(`Secondaire : ${hex(PPTX_THEME.accent2)}`);
    await expect(preview).toContainText(`Fond : ${hex(PPTX_THEME.lt1)}`);
    await expect(preview).toContainText(`Texte : ${hex(PPTX_THEME.dk1)}`);
    await expect(preview.getByRole("definition")).toHaveText([PPTX_THEME.major, PPTX_THEME.minor]);

    await preview.getByRole("button", { name: "Appliquer la charte" }).click();
    await expect(subject(page).getByText("Charte appliquée et enregistrée.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Charte : Personnalisé" })).toBeVisible();

    await page.goto(`/projets/${id}/charte`);
    await expect(page.getByRole("textbox", { name: "Principale (hexadécimal)" })).toHaveValue(hex(PPTX_THEME.accent1));
    await expect(page.getByRole("combobox", { name: "Titres" })).toHaveValue(PPTX_THEME.major);
    await expect(page.getByRole("combobox", { name: "Texte" })).toHaveValue(PPTX_THEME.minor);
  });

  test("devrait refuser un faux .pptx (texte renommé)", async ({ page, account }) => {
    void account;
    await createProject(page, "Faux pptx");
    await uploadSubjectFile(page, FILES.fakePptx);
    const alert = subject(page).getByRole("alert").filter({ hasText: "Import impossible" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("ne correspond pas à son extension");
    await expect(subject(page).getByRole("region", { name: "Charte proposée" })).toHaveCount(0);
  });

  test("devrait refuser un .pptm (macros)", async ({ page, account }) => {
    void account;
    await createProject(page, "Fichier pptm");
    await uploadSubjectFile(page, FILES.pptm);
    // Refusé dès le navigateur par la zone de dépôt (extension hors `accept`), avant tout envoi.
    await expect(subject(page).getByRole("alert").filter({ hasText: "Type de fichier non pris en charge" })).toBeVisible();
    await expect(subject(page).getByRole("region", { name: "Charte proposée" })).toHaveCount(0);
  });

  test("devrait demander le moteur Claude pour une image avec le moteur Gratuit", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    await createProject(page, "Image gratuite");
    await uploadSubjectFile(page, FILES.png);
    const alert = subject(page).getByRole("alert").filter({ hasText: "Import impossible" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/moteur Claude/);
  });

  test("devrait déduire une charte d'une image avec le moteur démo (Claude simulé)", async ({ page, account }) => {
    void account;
    await setEngine(page, "claude");
    await createProject(page, "Image démo");
    await uploadSubjectFile(page, FILES.png);
    const preview = subject(page).getByRole("region", { name: "Charte proposée" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Déduite par l'IA (moteur Claude).");
  });
});

test.describe("5. Préparer — importer votre sujet depuis un prompt", () => {
  test("devrait trouver 3 thèmes et la charte avec le moteur Gratuit, puis importer", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    const id = await createProject(page, "Prompt gratuit");
    const { preview } = await analyzePrompt(page, SUBJECT_PROMPT);
    await expect(preview).toContainText("Analyse sans IA (mots-clés)");
    const themes = preview.getByRole("group", { name: /Thèmes trouvés/ });
    await expect(themes.getByRole("checkbox")).toHaveCount(3);
    await expect(themes.getByRole("checkbox", { name: "Cybersécurité" })).toBeChecked();
    await expect(themes.getByRole("checkbox", { name: "Transformation numérique" })).toBeChecked();
    await expect(themes.getByRole("checkbox", { name: "Intelligence artificielle" })).toBeChecked();
    await expect(preview).toContainText("Principale : #1F3A5F");
    await expect(preview).toContainText("#F4AD15");
    await expect(preview.getByRole("definition").first()).toHaveText("Georgia");

    await preview.getByRole("button", { name: "Importer 3 thèmes et appliquer la charte" }).click();
    await expect(subject(page).getByText("3 thèmes importés. Charte appliquée.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Thèmes du projet" }).getByRole("heading", { level: 3 })).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Charte : Personnalisé" })).toBeVisible();

    // La charte importée reste modifiable.
    await page.goto(`/projets/${id}/charte`);
    const primary = page.getByRole("textbox", { name: "Principale (hexadécimal)" });
    await expect(primary).toHaveValue("#1F3A5F");
    await expect(page.getByRole("combobox", { name: "Titres" })).toHaveValue("Georgia");
    await primary.fill("#123456");
    await page.getByRole("button", { name: "Enregistrer la charte" }).click();
    await expect(page.getByText(/Charte enregistrée/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Principale (hexadécimal)" })).toHaveValue("#123456");
  });

  test("devrait importer seulement les thèmes cochés", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    await createProject(page, "Prompt décoché");
    const { preview } = await analyzePrompt(page, SUBJECT_PROMPT);
    await preview.getByRole("checkbox", { name: "Transformation numérique" }).uncheck();
    await expect(preview.getByText("(2 cochés sur 3)")).toBeVisible();
    await preview.getByRole("checkbox", { name: "Appliquer aussi la charte" }).uncheck();
    await preview.getByRole("button", { name: "Importer 2 thèmes" }).click();
    await expect(subject(page).getByText("2 thèmes importés.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Thèmes du projet" }).getByRole("heading", { level: 3 })).toHaveText([
      "Thème 1 : Cybersécurité",
      "Thème 2 : Intelligence artificielle",
    ]);
    await expect(page.getByRole("link", { name: "Charte : Par défaut" })).toBeVisible();
  });

  test("devrait bloquer l'import quand rien n'est coché", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    await createProject(page, "Prompt rien coché");
    const { preview } = await analyzePrompt(page, SUBJECT_PROMPT);
    for (const name of ["Cybersécurité", "Transformation numérique", "Intelligence artificielle", "Appliquer aussi la charte"]) {
      await preview.getByRole("checkbox", { name }).uncheck();
    }
    const button = preview.getByRole("button", { name: "Importer les thèmes" });
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(preview.getByText("Cochez au moins un thème, ou la charte, pour importer.")).toBeVisible();
  });

  test("devrait analyser le même prompt avec le moteur démo (badge IA) et importer", async ({ page, account }) => {
    void account;
    await setEngine(page, "claude");
    await createProject(page, "Prompt démo");
    const { preview } = await analyzePrompt(page, SUBJECT_PROMPT);
    await expect(preview).toContainText("Analysé par l'IA");
    await expect(preview.getByRole("checkbox", { name: "Cybersécurité" })).toBeChecked();
    await expect(preview.getByRole("group", { name: /Thèmes trouvés/ }).getByRole("checkbox")).toHaveCount(3);
    await expect(preview).toContainText("Principale : #1F3A5F");
    await expect(preview).toContainText("#F4AD15");
    await preview.getByRole("button", { name: "Importer 3 thèmes et appliquer la charte" }).click();
    await expect(subject(page).getByText("3 thèmes importés. Charte appliquée.")).toBeVisible();
  });

  test("devrait signaler un prompt sans thème ni charte reconnus", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    await createProject(page, "Prompt vide de sens");
    const { preview } = await analyzePrompt(page, "Bonjour, ceci est un texte sans aucune information utile pour l'oral.");
    await expect(preview).toContainText("Aucun thème ni charte reconnus dans ce texte.");
  });
});
