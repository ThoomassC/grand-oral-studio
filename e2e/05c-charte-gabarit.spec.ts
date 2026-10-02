import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList, setEngine } from "./support/app";
import { FILES, TEMPLATE_PROMPT } from "./support/files";
import type { Locator, Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const LEAVE = "Quitter sans enregistrer ?";

/** Rend la page « sale » : Charte (couleur principale) ou Gabarit (durée). */
async function makeDirty(page: Page, which: "charte" | "gabarit") {
  if (which === "charte") await page.getByRole("textbox", { name: "Principale (hexadécimal)" }).fill("#ABCDEF");
  else await page.getByRole("spinbutton", { name: "Durée de l'oral (minutes)" }).fill("25");
}

type Exit = { label: string; link: (page: Page, id: string) => Locator };

const EXITS: Exit[] = [
  { label: "étapes du projet (Étape 2)", link: (p) => p.getByRole("navigation", { name: "Étapes du projet" }).getByRole("link", { name: /^Étape 2 : Squelettes/ }) },
  { label: "lien Decks des étapes", link: (p) => p.getByRole("navigation", { name: "Diaporamas du projet" }).getByRole("link", { name: /^Decks/ }) },
  { label: "sous-nav Préparer (Thèmes)", link: (p) => p.getByRole("navigation", { name: "Préparer : thèmes, charte et gabarit" }).getByRole("link", { name: /^Thèmes/ }) },
  { label: "fil d'Ariane (Projets)", link: (p) => p.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Projets" }) },
  { label: "barre du bas (étape précédente)", link: (p) => p.getByRole("navigation", { name: "Étapes précédente et suivante" }).getByRole("link", { name: /^Étape précédente/ }) },
  { label: "en-tête (onglet Projets)", link: (p) => p.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Projets" }) },
  { label: "en-tête (logo)", link: (p) => p.getByRole("banner").getByRole("link", { name: "Grand Oral Studio" }) },
];

for (const which of ["charte", "gabarit"] as const) {
  test.describe(`5. Préparer — garde « modifications non enregistrées » (${which})`, () => {
    for (const exit of EXITS) {
      test(`devrait demander confirmation en quittant la ${which} modifiée par ${exit.label}`, async ({ page, account }) => {
        void account;
        const id = await createProject(page, `Garde ${which}`);
        await page.goto(`/projets/${id}/${which}`);
        await makeDirty(page, which);
        const link = exit.link(page, id);
        await link.click();
        const modal = dialog(page, LEAVE);
        await expect(modal, `aucune modale « ${LEAVE} » via ${exit.label}`).toBeVisible();
        await modal.getByRole("button", { name: "Rester sur la page" }).click();
        await expect(modal).toBeHidden();
        await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
        await expect(link).toBeFocused();

        await link.click();
        await dialog(page, LEAVE).getByRole("button", { name: "Quitter sans enregistrer" }).click();
        await expect(page).not.toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
      });
    }

    test(`devrait demander confirmation en quittant la ${which} modifiée par le menu du compte (Informations du profil)`, async ({ page, account }) => {
      const id = await createProject(page, `Garde menu ${which}`);
      await page.goto(`/projets/${id}/${which}`);
      await makeDirty(page, which);
      await page.getByRole("button", { name: `Compte : ${account.email}` }).click();
      await page.getByRole("menuitem", { name: "Informations du profil" }).click();
      await expect(dialog(page, LEAVE), "aucune modale via le menu du compte").toBeVisible();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
    });

    test(`devrait garder la ${which} modifiée sur « Précédent » du navigateur`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Garde retour ${which}`);
      // Navigation interne (côté client) Thèmes → page, puis « Précédent ».
      await page
        .getByRole("navigation", { name: "Préparer : thèmes, charte et gabarit" })
        .getByRole("link", { name: which === "charte" ? /^Charte/ : /^Gabarit/ })
        .click();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
      await makeDirty(page, which);
      page.on("dialog", (d) => void d.dismiss());
      await page.goBack();
      await expect(page, "« Précédent » a quitté la page sans confirmation").toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
    });

    test(`devrait déclencher l'alerte native beforeunload en quittant la ${which} modifiée pour un autre site`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Garde unload ${which}`);
      await page.goto(`/projets/${id}/${which}`);
      await makeDirty(page, which);
      const dialogPromise = page.waitForEvent("dialog");
      void page.goto("about:blank").catch(() => undefined);
      const native = await dialogPromise;
      expect(native.type()).toBe("beforeunload");
      await native.dismiss();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
    });

    test(`ne devrait pas demander de confirmation quand la ${which} n'est pas modifiée`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Sans garde ${which}`);
      await page.goto(`/projets/${id}/${which}`);
      await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Projets" }).click();
      await expect(page).toHaveURL(`${BASE_URL}/projets`);
    });

    test(`ne devrait plus demander de confirmation après enregistrement de la ${which}`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Garde levée ${which}`);
      await page.goto(`/projets/${id}/${which}`);
      await makeDirty(page, which);
      await page.getByRole("button", { name: which === "charte" ? "Enregistrer la charte" : "Enregistrer le gabarit" }).click();
      await expect(page.getByText(which === "charte" ? "Charte enregistrée." : "Gabarit enregistré.")).toBeVisible();
      await page.getByRole("navigation", { name: "Préparer : thèmes, charte et gabarit" }).getByRole("link", { name: /^Thèmes/ }).click();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}`);
    });
  });
}

test.describe("5. Préparer — gabarit depuis un prompt", () => {
  async function expectFourSections(preview: Locator) {
    await expect(preview.getByRole("listitem").filter({ hasText: "diapo" })).toHaveText([
      "Introduction — 1 diapo",
      "Problématique — 1 diapo",
      "Développement en deux parties — 4 diapos",
      "Conclusion — 1 diapo",
    ]);
    await expect(preview).toContainText("8 diapos, couverture comprise");
    await expect(preview).toContainText("20 min");
    await expect(preview).toContainText("16:9 (écran large)");
  }

  test("devrait reconnaître 4 sections d'un prompt sur une ligne (Gratuit), appliquer et enregistrer", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    const id = await createProject(page, "Gabarit prompt");
    await page.goto(`/projets/${id}/gabarit`);
    const region = page.getByRole("region", { name: "Préremplir avec un prompt" });
    await region.getByLabel("Consignes ou prompt").fill(TEMPLATE_PROMPT);
    await region.getByRole("button", { name: "Analyser le prompt" }).click();
    const preview = region.getByRole("region", { name: "Gabarit proposé" });
    await expect(preview).toBeVisible();
    await expectFourSections(preview);
    await expect(preview).toContainText(/professionnel/i);

    await preview.getByRole("button", { name: "Appliquer au gabarit" }).click();
    await expect(page.getByText("Gabarit importé dans le formulaire : vérifiez puis enregistrez.")).toBeVisible();
    const sections = page.getByRole("group", { name: "Sections" }).getByRole("listitem");
    await expect(sections).toHaveCount(4);
    await expect(page.getByRole("textbox", { name: "Titre de la section 3" })).toHaveValue("Développement en deux parties");
    await expect(page.getByRole("textbox", { name: "Ton" })).toHaveValue(/professionnel/i);

    await page.getByRole("button", { name: "Enregistrer le gabarit" }).click();
    await expect(page.getByText("Gabarit enregistré.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("group", { name: "Sections" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("link", { name: "Gabarit : Personnalisé" })).toBeVisible();
  });

  test("devrait charger un fichier .txt dans le champ et reconnaître les 4 sections", async ({ page, account }) => {
    void account;
    await setEngine(page, "free");
    const id = await createProject(page, "Gabarit fichier");
    await page.goto(`/projets/${id}/gabarit`);
    const region = page.getByRole("region", { name: "Préremplir avec un prompt" });
    await region.locator('input[type="file"]').setInputFiles(FILES.promptTxt);
    await expect(region.getByLabel("Consignes ou prompt")).toHaveValue(TEMPLATE_PROMPT + "\n");
    await region.getByRole("button", { name: "Analyser le prompt" }).click();
    const preview = region.getByRole("region", { name: "Gabarit proposé" });
    await expectFourSections(preview);
  });

  test("devrait reconnaître les 4 sections avec le moteur démo (badge IA)", async ({ page, account }) => {
    void account;
    await setEngine(page, "claude");
    const id = await createProject(page, "Gabarit démo");
    await page.goto(`/projets/${id}/gabarit`);
    const region = page.getByRole("region", { name: "Préremplir avec un prompt" });
    await region.getByLabel("Consignes ou prompt").fill(TEMPLATE_PROMPT);
    await region.getByRole("button", { name: "Analyser le prompt" }).click();
    const preview = region.getByRole("region", { name: "Gabarit proposé" });
    await expect(preview).toContainText("IA");
    await expectFourSections(preview);
  });
});

test.describe("5. Préparer — gabarit : limites et passage aux squelettes", () => {
  test("devrait refuser un gabarit de plus de 60 diapos", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Gabarit 61 diapos");
    await page.goto(`/projets/${id}/gabarit`);
    const counts = page.getByRole("group", { name: "Sections" }).getByRole("spinbutton", { name: "Diapos" });
    await expect(counts).toHaveCount(7);
    for (let i = 0; i < 7; i += 1) await counts.nth(i).fill("8"); // 1 + 56 = 57
    await page.getByRole("button", { name: "Ajouter une section" }).click();
    await counts.nth(7).fill("4"); // 61
    await page.getByRole("button", { name: "Enregistrer le gabarit" }).click();
    await expect(page.getByText("Le gabarit dépasse 60 diapos : réduisez le nombre de diapos par section.")).toBeVisible();

    await counts.nth(7).fill("3"); // 60 : accepté
    await page.getByRole("button", { name: "Enregistrer le gabarit" }).click();
    await expect(page.getByText("Gabarit enregistré.")).toBeVisible();
  });

  test("devrait proposer « Passer aux squelettes » une fois des thèmes présents", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Vers squelettes");
    await expect(page.getByRole("navigation", { name: "Étapes du projet" })).toContainText("bloquée");
    await importThemeList(page, id);
    await page.goto(`/projets/${id}/gabarit`);
    await page.getByRole("link", { name: "Passer aux squelettes", exact: true }).first().click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/squelettes`);
    await expect(page.getByRole("heading", { name: "Squelettes", level: 2 })).toBeVisible();
  });
});

test.describe("5. Préparer — validations Charte et Gabarit", () => {
  test("devrait refuser une couleur hexadécimale invalide", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Couleur invalide");
    await page.goto(`/projets/${id}/charte`);
    const primary = page.getByRole("textbox", { name: "Principale (hexadécimal)" });
    await primary.fill("#12");
    await page.getByRole("button", { name: "Enregistrer la charte" }).click();
    await expect(page.getByRole("main").getByText("Couleur attendue au format #RRGGBB (ex. #1F4E79).")).toBeVisible();
    await expect(primary).toHaveAttribute("aria-invalid", "true");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Principale (hexadécimal)" })).toHaveValue("#1E3A5F");
  });

  test("devrait refuser une durée de 2 minutes et 9 diapos dans une section", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Gabarit invalide");
    await page.goto(`/projets/${id}/gabarit`);
    await page.getByRole("spinbutton", { name: "Durée de l'oral (minutes)" }).fill("2");
    await page.getByRole("group", { name: "Sections" }).getByRole("spinbutton", { name: "Diapos" }).first().fill("9");
    await page.getByRole("button", { name: "Enregistrer le gabarit" }).click();
    await expect(page.getByRole("main").getByText("L'oral dure au moins 3 minutes.")).toBeVisible();
    await expect(page.getByRole("main").getByText("Une section compte au plus 8 diapos.")).toBeVisible();
  });
});

