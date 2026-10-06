import { test, expect } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, waitForHydration } from "./support/app";
import { FILES, PPTX_THEME, SUBJECT_PROMPT } from "./support/files";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

/*
 * Imports sans IA (v1.1.0) : l'apparence « Partir d'un exemple » (fichier .pptx
 * ou prompt) sur la page Apparence, et « Importer des sujets depuis un texte »
 * sur l'onglet Sujets de la Trame. L'import d'une charte depuis un PDF ou une
 * image (Claude) est retiré.
 * Portée <main> : juste après une navigation, le streaming peut laisser une copie
 * masquée hors de <main>.
 */

const RETIRED_FORMAT_MESSAGE =
  "L'import depuis un PDF ou une image n'est plus proposé : utilisez un .pptx, .potx ou .thmx d'exemple.";

const hex = (h: string) => `#${h}`;

function example(page: Page) {
  return page.getByRole("main").getByRole("region", { name: "Partir d'un exemple" });
}

function filePanel(page: Page) {
  return example(page).getByRole("tabpanel", { name: "Depuis un fichier .pptx" });
}

function appearanceStep(page: Page) {
  return page.getByRole("navigation", { name: "Étapes du projet" }).getByRole("link", { name: /Apparence/ });
}

async function uploadExampleFile(page: Page, file: string) {
  await filePanel(page).locator('input[type="file"]').setInputFiles(file);
}

/** Mode « Depuis un prompt » de l'Apparence : analyse le texte et renvoie l'aperçu. */
async function analyzeAppearancePrompt(page: Page, text: string) {
  const tab = example(page).getByRole("tab", { name: "Depuis un prompt" });
  await waitForHydration(tab);
  await tab.click();
  const panel = example(page).getByRole("tabpanel", { name: "Depuis un prompt" });
  await panel.getByLabel("Description de l'apparence").fill(text);
  await panel.getByRole("button", { name: "Analyser le prompt" }).click();
  return panel;
}

function subjectsImport(page: Page) {
  return page.getByRole("main").getByRole("region", { name: "Importer des sujets depuis un texte" });
}

/** Ouvre l'onglet Sujets, colle le texte et lance l'analyse ; renvoie l'aperçu « Sujets proposés ». */
async function analyzeSubjectsPrompt(page: Page, programId: string, text: string) {
  await page.goto(`/projets/${programId}/trame/sujets`);
  const block = subjectsImport(page);
  const field = block.getByLabel("Vos sujets ou vos consignes");
  await waitForHydration(field);
  await field.fill(text);
  await block.getByRole("button", { name: "Analyser le prompt" }).click();
  const preview = block.getByRole("region", { name: "Sujets proposés" });
  await expect(preview).toBeVisible();
  return preview;
}

function subjectTitles(page: Page) {
  return page.getByRole("main").getByRole("list", { name: "Sujets du projet" }).getByRole("heading", { level: 4 });
}

test.describe("5. Apparence — partir d'un exemple depuis un fichier .pptx", () => {
  test("devrait lire couleurs et polices d'un .pptx, les appliquer, et passer l'Apparence en « Personnalisée »", async ({
    page,
    account,
  }) => {
    void account;
    await createProject(page, "Import pptx");
    await expect(appearanceStep(page)).toHaveAccessibleName(/Apparence, Par défaut/);
    await uploadExampleFile(page, FILES.pptx);
    const preview = filePanel(page).getByRole("region", { name: "Apparence proposée" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Lue dans le fichier, sans IA.");
    await expect(preview).toContainText(`Principale : ${hex(PPTX_THEME.accent1)}`);
    await expect(preview).toContainText(`Secondaire : ${hex(PPTX_THEME.accent2)}`);
    await expect(preview).toContainText(`Fond : ${hex(PPTX_THEME.lt1)}`);
    await expect(preview).toContainText(`Texte : ${hex(PPTX_THEME.dk1)}`);
    await expect(preview.getByRole("definition")).toHaveText([PPTX_THEME.major, PPTX_THEME.minor]);

    await preview.getByRole("button", { name: "Appliquer l'apparence" }).click();
    await expect(filePanel(page).getByText("Apparence appliquée et enregistrée.")).toBeVisible();
    await expect(appearanceStep(page)).toHaveAccessibleName(/Apparence, Personnalisée/);

    // L'éditeur, juste en dessous, est remonté sur l'apparence importée.
    await page.reload();
    const main = page.getByRole("main");
    await expect(main.getByRole("textbox", { name: "Principale (hexadécimal)" })).toHaveValue(hex(PPTX_THEME.accent1));
    await expect(main.getByRole("combobox", { name: "Titres" })).toHaveValue(PPTX_THEME.major);
    await expect(main.getByRole("combobox", { name: "Texte" })).toHaveValue(PPTX_THEME.minor);
  });

  test("devrait refuser un faux .pptx (texte renommé)", async ({ page, account }) => {
    void account;
    await createProject(page, "Faux pptx");
    await uploadExampleFile(page, FILES.fakePptx);
    const alert = filePanel(page).getByRole("alert").filter({ hasText: "Import impossible" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("ne correspond pas à son extension");
    await expect(filePanel(page).getByRole("region", { name: "Apparence proposée" })).toHaveCount(0);
  });

  for (const [label, file] of [
    [".pptm", FILES.pptm],
    [".potm", FILES.potm],
  ] as const) {
    test(`devrait refuser un ${label} (macros) avec le message dédié, sans envoi`, async ({ page, account }) => {
      void account;
      await createProject(page, `Fichier ${label}`);
      const uploads: string[] = [];
      page.on("request", (req) => {
        if (req.method() === "POST" && req.postData()?.includes("vbaProject")) uploads.push(req.url());
      });
      await uploadExampleFile(page, file);
      // Refusé dès le navigateur, avec sa raison (et non le message générique « type non pris en charge »).
      const alert = filePanel(page).getByRole("alert").filter({ hasText: "Import impossible" });
      await expect(alert).toContainText(
        "Les fichiers avec macros (.pptm, .potm) sont refusés : enregistrez la présentation en .pptx.",
      );
      await expect(filePanel(page).getByText("Type de fichier non pris en charge")).toHaveCount(0);
      await expect(filePanel(page).getByRole("region", { name: "Apparence proposée" })).toHaveCount(0);
      expect(uploads, "le fichier à macros a été envoyé au serveur").toEqual([]);
    });
  }

  test("devrait refuser une image avec le message des formats retirés, sans appel au serveur", async ({ page, account }) => {
    void account;
    await createProject(page, "Image retirée");
    const actions: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actions.push(r.url());
    });
    await uploadExampleFile(page, FILES.png);
    const alert = filePanel(page).getByRole("alert").filter({ hasText: "Import impossible" });
    await expect(alert).toContainText(RETIRED_FORMAT_MESSAGE);
    await expect(filePanel(page).getByRole("region", { name: "Apparence proposée" })).toHaveCount(0);
    expect(actions, "aucune Server Action ne doit partir pour une image").toEqual([]);
  });
});

test.describe("5. Apparence — partir d'un exemple depuis un prompt", () => {
  test("devrait reconnaître couleurs et police sans IA, appliquer l'apparence et la garder modifiable", async ({ page, account }) => {
    void account;
    await createProject(page, "Apparence par prompt");
    const panel = await analyzeAppearancePrompt(page, SUBJECT_PROMPT);
    const preview = panel.getByRole("region", { name: "Apparence proposée" });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("list", { name: "Éléments reconnus" })).toBeVisible();
    await expect(preview).toContainText("Principale : #1F3A5F");
    await expect(preview).toContainText("#F4AD15");
    await expect(preview.getByRole("definition").first()).toHaveText("Georgia");
    // Le prompt cite aussi des sujets : ils ne sont ni montrés ni importés depuis l'Apparence.
    await expect(preview.getByRole("checkbox")).toHaveCount(0);

    await preview.getByRole("button", { name: "Appliquer l'apparence" }).click();
    await expect(panel.getByText("Apparence appliquée et enregistrée.")).toBeVisible();
    await expect(appearanceStep(page)).toHaveAccessibleName(/Apparence, Personnalisée/);

    await page.reload();
    const main = page.getByRole("main");
    const primary = main.getByRole("textbox", { name: "Principale (hexadécimal)" });
    await expect(primary).toHaveValue("#1F3A5F");
    await expect(main.getByRole("combobox", { name: "Titres" })).toHaveValue("Georgia");
    await primary.fill("#123456");
    await main.getByRole("button", { name: "Enregistrer l'apparence" }).click();
    await expect(main.getByText("Apparence enregistrée.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("main").getByRole("textbox", { name: "Principale (hexadécimal)" })).toHaveValue("#123456");
  });

  test("devrait signaler un texte sans couleur ni police reconnue", async ({ page, account }) => {
    void account;
    await createProject(page, "Apparence vide de sens");
    const panel = await analyzeAppearancePrompt(page, "Bonjour, ceci est un texte sans aucune information utile pour l'oral.");
    await expect(panel.getByText("Aucune couleur ni police reconnue dans ce texte.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Appliquer l'apparence" })).toHaveCount(0);
  });
});

test.describe("5. Sujets — importer des sujets depuis un texte", () => {
  test("devrait trouver 3 sujets sans IA, puis les importer sans toucher à l'apparence", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Sujets par prompt");
    const preview = await analyzeSubjectsPrompt(page, id, SUBJECT_PROMPT);
    const found = preview.getByRole("group", { name: /Sujets trouvés/ });
    await expect(found.getByRole("checkbox")).toHaveCount(3);
    await expect(found.getByRole("checkbox", { name: "Cybersécurité" })).toBeChecked();
    await expect(found.getByRole("checkbox", { name: "Transformation numérique" })).toBeChecked();
    await expect(found.getByRole("checkbox", { name: "Intelligence artificielle" })).toBeChecked();
    // Les couleurs du même texte ne sont pas proposées depuis l'onglet Sujets.
    await expect(preview).not.toContainText("#1F3A5F");

    await preview.getByRole("button", { name: "Importer 3 sujets" }).click();
    await expect(subjectsImport(page).getByText("3 sujets importés.")).toBeVisible();
    await expect(subjectsImport(page).getByRole("link", { name: "Passer au Jour J" })).toHaveAttribute("href", `/projets/${id}/jour-j`);
    await expect(subjectTitles(page)).toHaveCount(3);
    await expect(appearanceStep(page)).toHaveAccessibleName(/Apparence, Par défaut/);
  });

  test("devrait importer seulement les sujets cochés", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Prompt décoché");
    const preview = await analyzeSubjectsPrompt(page, id, SUBJECT_PROMPT);
    await preview.getByRole("checkbox", { name: "Transformation numérique" }).uncheck();
    await expect(preview.getByText("(2 cochés sur 3)")).toBeVisible();
    await preview.getByRole("button", { name: "Importer 2 sujets" }).click();
    await expect(subjectsImport(page).getByText("2 sujets importés.")).toBeVisible();
    await expect(subjectTitles(page)).toHaveText(["Sujet 1 : Cybersécurité", "Sujet 2 : Intelligence artificielle"]);
  });

  test("devrait bloquer l'import quand rien n'est coché", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Prompt rien coché");
    const preview = await analyzeSubjectsPrompt(page, id, SUBJECT_PROMPT);
    for (const name of ["Cybersécurité", "Transformation numérique", "Intelligence artificielle"]) {
      await preview.getByRole("checkbox", { name }).uncheck();
    }
    const button = preview.getByRole("button", { name: "Importer les sujets" });
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(preview.getByText("Cochez au moins un sujet pour importer.")).toBeVisible();
  });

  test("devrait compter les sujets déjà présents lors d'un second import", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Prompt rejoué");
    const first = await analyzeSubjectsPrompt(page, id, SUBJECT_PROMPT);
    await first.getByRole("button", { name: "Importer 3 sujets" }).click();
    await expect(subjectsImport(page).getByText("3 sujets importés.")).toBeVisible();

    const second = await analyzeSubjectsPrompt(page, id, SUBJECT_PROMPT);
    await second.getByRole("button", { name: "Importer 3 sujets" }).click();
    await expect(subjectsImport(page).getByText("Aucun nouveau sujet importé, 3 déjà présents.")).toBeVisible();
    await expect(subjectTitles(page)).toHaveCount(3);
  });

  test("devrait signaler un texte sans sujet reconnu", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Prompt vide de sens");
    await page.goto(`/projets/${id}/trame/sujets`);
    const block = subjectsImport(page);
    const field = block.getByLabel("Vos sujets ou vos consignes");
    await waitForHydration(field);
    await field.fill("Bonjour, ceci est un texte sans aucune information utile pour l'oral.");
    await block.getByRole("button", { name: "Analyser le prompt" }).click();
    await expect(block.getByText("Aucun sujet reconnu dans ce texte.")).toBeVisible();
  });
});
