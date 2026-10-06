import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, waitForHydration } from "./support/app";
import { FILES, TEMPLATE_PROMPT } from "./support/files";
import type { Locator, Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

/*
 * Étape 1 · Apparence et étape 2 · Trame (v1.1.0) : garde « modifications non
 * enregistrées », trame depuis un prompt (lue sans IA), contenu type et durée par
 * ligne, limites de la trame et validations de l'apparence.
 * Portée <main> : juste après une navigation, le streaming peut laisser une copie
 * masquée hors de <main>.
 */

const LEAVE = "Quitter sans enregistrer ?";

type Which = "apparence" | "trame";

const PAGE: Record<
  Which,
  { heading: string; save: string; saved: string; from: Which; stepLink: RegExp; dirty: (page: Page) => Promise<void> }
> = {
  apparence: {
    heading: "Apparence",
    save: "Enregistrer l'apparence",
    saved: "Apparence enregistrée.",
    from: "trame",
    stepLink: /^Étape 1 : Apparence/,
    dirty: (page) => page.getByRole("main").getByRole("textbox", { name: "Principale (hexadécimal)" }).fill("#ABCDEF"),
  },
  trame: {
    heading: "Trame",
    save: "Enregistrer la trame",
    saved: "Trame enregistrée.",
    from: "apparence",
    stepLink: /^Étape 2 : Trame/,
    dirty: (page) => page.getByRole("main").getByRole("spinbutton", { name: "Durée de l'oral (minutes)" }).fill("25"),
  },
};

function main(page: Page) {
  return page.getByRole("main");
}

function projectSteps(page: Page) {
  return page.getByRole("navigation", { name: "Étapes du projet" });
}

/** Ouvre une étape du projet, formulaire hydraté (une saisie avant l'hydratation serait perdue). */
async function openStep(page: Page, id: string, which: Which): Promise<void> {
  await page.goto(`/projets/${id}/${which}`);
  await waitForHydration(main(page).getByRole("button", { name: PAGE[which].save }));
}

/** Arrive sur la page par une navigation interne depuis l'autre étape (historique côté client). */
async function reachByStepLink(page: Page, id: string, which: Which): Promise<void> {
  const { from, stepLink } = PAGE[which];
  await openStep(page, id, from);
  await projectSteps(page).getByRole("link", { name: stepLink }).click();
  await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
  await waitForHydration(main(page).getByRole("button", { name: PAGE[which].save }));
}

type Exit = { label: string; link: (page: Page) => Locator };

const EXITS: Exit[] = [
  { label: "étapes du projet (Étape 3)", link: (p) => projectSteps(p).getByRole("link", { name: /^Étape 3 : Jour J/ }) },
  { label: "lien Decks des étapes", link: (p) => p.getByRole("navigation", { name: "Diaporamas du projet" }).getByRole("link", { name: /^Decks/ }) },
  { label: "fil d'Ariane (Projets)", link: (p) => p.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Projets" }) },
  { label: "barre du bas (étape suivante)", link: (p) => p.getByRole("navigation", { name: "Étapes précédente et suivante" }).getByRole("link", { name: /^Étape suivante/ }) },
  { label: "en-tête (onglet Projets)", link: (p) => p.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Projets" }) },
  { label: "en-tête (logo)", link: (p) => p.getByRole("banner").getByRole("link", { name: "Grand Oral Studio" }) },
];

/** Sortie propre à la Trame : son onglet Sujets. */
const SUBJECTS_TAB: Exit = {
  label: "onglets de la Trame (Sujets)",
  link: (p) => p.getByRole("navigation", { name: "Trame : diapos et sujets" }).getByRole("link", { name: /^Sujets/ }),
};

const EXITS_BY_PAGE: Record<Which, Exit[]> = { apparence: EXITS, trame: [...EXITS, SUBJECTS_TAB] };

for (const which of ["apparence", "trame"] as const) {
  const conf = PAGE[which];

  test.describe(`5. ${conf.heading} — garde « modifications non enregistrées »`, () => {
    for (const exit of EXITS_BY_PAGE[which]) {
      test(`devrait demander confirmation en quittant la page ${which} modifiée par ${exit.label}`, async ({ page, account }) => {
        void account;
        const id = await createProject(page, `Garde ${which}`);
        await openStep(page, id, which);
        await conf.dirty(page);
        const link = exit.link(page);
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

    test(`devrait demander confirmation en quittant la page ${which} modifiée par le menu du compte (Informations du profil)`, async ({
      page,
      account,
    }) => {
      const id = await createProject(page, `Garde menu ${which}`);
      await openStep(page, id, which);
      await conf.dirty(page);
      await page.getByRole("button", { name: `Compte : ${account.email}` }).click();
      await page.getByRole("menuitem", { name: "Informations du profil" }).click();
      await expect(dialog(page, LEAVE), "aucune modale via le menu du compte").toBeVisible();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
    });

    test(`devrait garder la page ${which} modifiée sur « Précédent » du navigateur`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Garde retour ${which}`);
      await reachByStepLink(page, id, which);
      await conf.dirty(page);
      page.on("dialog", (d) => void d.dismiss());
      await page.goBack();
      await expect(page, "« Précédent » a quitté la page sans confirmation").toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
    });

    test(`devrait confirmer « Précédent » sur la page ${which} modifiée : rester, puis quitter vers la page précédente`, async ({
      page,
      account,
    }) => {
      void account;
      const id = await createProject(page, `Garde retour modale ${which}`);
      await reachByStepLink(page, id, which);
      await conf.dirty(page);
      await page.goBack();
      const modal = dialog(page, LEAVE);
      await expect(modal).toBeVisible();
      await modal.getByRole("button", { name: "Rester sur la page" }).click();
      await expect(modal).toBeHidden();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
      await page.goBack();
      await dialog(page, LEAVE).getByRole("button", { name: "Quitter sans enregistrer" }).click();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${conf.from}`);
      await expect(main(page).getByRole("heading", { name: PAGE[conf.from].heading, level: 2 })).toBeVisible();
    });

    test(`ne devrait pas allonger l'historique : après enregistrement de la page ${which}, « Précédent » revient à la page précédente`, async ({
      page,
      account,
    }) => {
      void account;
      const id = await createProject(page, `Historique ${which}`);
      await reachByStepLink(page, id, which);
      await conf.dirty(page);
      await main(page).getByRole("button", { name: conf.save }).click();
      await expect(main(page).getByText(conf.saved)).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${conf.from}`);
      await expect(dialog(page, LEAVE)).toHaveCount(0);
    });

    test(`ne devrait pas laisser d'entrée en double après avoir quitté la page ${which} modifiée par un lien`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Historique lien ${which}`);
      await reachByStepLink(page, id, which);
      await conf.dirty(page);
      await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Projets" }).click();
      await dialog(page, LEAVE).getByRole("button", { name: "Quitter sans enregistrer" }).click();
      await expect(page).toHaveURL(`${BASE_URL}/projets`);
      // Projets ← page (une seule entrée) ← page de départ.
      await page.goBack();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
      await page.goBack();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${conf.from}`);
    });

    test(`devrait déclencher l'alerte native beforeunload en quittant la page ${which} modifiée pour un autre site`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Garde unload ${which}`);
      await openStep(page, id, which);
      await conf.dirty(page);
      const dialogPromise = page.waitForEvent("dialog");
      void page.goto("about:blank").catch(() => undefined);
      const native = await dialogPromise;
      expect(native.type()).toBe("beforeunload");
      await native.dismiss();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/${which}`);
    });

    test(`ne devrait pas demander de confirmation quand la page ${which} n'est pas modifiée`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Sans garde ${which}`);
      await openStep(page, id, which);
      await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Projets" }).click();
      await expect(page).toHaveURL(`${BASE_URL}/projets`);
    });

    test(`ne devrait plus demander de confirmation après enregistrement de la page ${which}`, async ({ page, account }) => {
      void account;
      const id = await createProject(page, `Garde levée ${which}`);
      await openStep(page, id, which);
      await conf.dirty(page);
      await main(page).getByRole("button", { name: conf.save }).click();
      await expect(main(page).getByText(conf.saved)).toBeVisible();
      await projectSteps(page).getByRole("link", { name: /^Étape 3 : Jour J/ }).click();
      await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/jour-j`);
    });
  });
}

/** Champs d'une ligne de la trame, par leur nom accessible « … de la ligne N ». */
function line(page: Page, n: number) {
  const m = main(page);
  return {
    title: m.getByRole("textbox", { name: `Titre de la ligne ${n}`, exact: true }),
    slides: m.getByRole("spinbutton", { name: `Nombre de diapos de la ligne ${n}`, exact: true }),
    guidance: m.getByRole("textbox", { name: `Contenu type de la ligne ${n}`, exact: true }),
    duration: m.getByRole("textbox", { name: `Durée de la ligne ${n}`, exact: true }),
  };
}

function lineTitles(page: Page) {
  return main(page).getByRole("textbox", { name: /^Titre de la ligne \d+$/ });
}

function slidesTab(page: Page) {
  return page.getByRole("navigation", { name: "Trame : diapos et sujets" }).getByRole("link", { name: /^Diapos/ });
}

test.describe("5. Trame — contenu type et durée par ligne", () => {
  test("devrait enregistrer le contenu type et la durée 3:30 d'une ligne, et les relire après rechargement", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame contenu type");
    await openStep(page, id, "trame");
    await expect(slidesTab(page)).toHaveAccessibleName("Diapos : Par défaut");
    const first = line(page, 1);
    await first.guidance.fill("Accroche : un chiffre fort, puis la problématique.");
    await first.duration.fill("3:30");
    await main(page).getByRole("button", { name: "Enregistrer la trame" }).click();
    await expect(main(page).getByText("Trame enregistrée.")).toBeVisible();

    await page.reload();
    const reloaded = line(page, 1);
    await expect(reloaded.guidance).toHaveValue("Accroche : un chiffre fort, puis la problématique.");
    await expect(reloaded.duration).toHaveValue("3:30");
    await expect(line(page, 2).duration).toHaveValue("");
    await expect(slidesTab(page)).toHaveAccessibleName("Diapos : Personnalisée");
  });

  test("devrait refuser une durée de ligne illisible avec le format attendu", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame durée illisible");
    await openStep(page, id, "trame");
    const first = line(page, 1);
    await first.duration.fill("trois");
    await main(page).getByRole("button", { name: "Enregistrer la trame" }).click();
    await expect(main(page).getByText("Durée attendue au format 3:30 (minutes:secondes).")).toBeVisible();
    await expect(first.duration).toHaveAttribute("aria-invalid", "true");
    await expect(first.duration).toBeFocused();
  });

  test("devrait recharger la trame par défaut sans l'enregistrer", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame par défaut");
    await openStep(page, id, "trame");
    await line(page, 1).title.fill("Titre modifié");
    await main(page).getByRole("button", { name: "Revenir à la trame par défaut" }).click();
    await expect(main(page).getByText("Trame par défaut chargée. Enregistrez pour l'appliquer.")).toBeVisible();
    await expect(line(page, 1).title).toHaveValue("Introduction");
    await expect(lineTitles(page)).toHaveCount(7);
  });
});

test.describe("5. Trame — depuis un prompt (sans IA)", () => {
  function promptRegion(page: Page) {
    return main(page).getByRole("region", { name: "Préremplir avec un prompt" });
  }

  function proposedLines(preview: Locator) {
    return preview.getByRole("list", { name: /^Lignes/ }).getByRole("listitem");
  }

  async function expectFourSections(preview: Locator) {
    await expect(proposedLines(preview)).toHaveText([
      "Introduction — 1 diapo",
      "Problématique — 1 diapo",
      "Développement en deux parties — 4 diapos",
      "Conclusion — 1 diapo",
    ]);
    await expect(preview).toContainText("8 diapos, couverture comprise");
    await expect(preview).toContainText("20 min");
    await expect(preview).toContainText("16:9 (écran large)");
  }

  test("devrait reconnaître 4 lignes d'un prompt sur une ligne, appliquer à la trame et enregistrer", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame prompt");
    await openStep(page, id, "trame");
    const region = promptRegion(page);
    await region.getByLabel("Consignes ou prompt").fill(TEMPLATE_PROMPT);
    await region.getByRole("button", { name: "Analyser le prompt" }).click();
    const preview = region.getByRole("region", { name: "Trame proposée" });
    await expect(preview).toBeVisible();
    await expectFourSections(preview);
    await expect(preview).toContainText(/professionnel/i);

    await preview.getByRole("button", { name: "Appliquer à la trame" }).click();
    await expect(main(page).getByText("Trame importée dans le formulaire : vérifiez puis enregistrez.")).toBeVisible();
    await expect(lineTitles(page)).toHaveCount(4);
    await expect(line(page, 3).title).toHaveValue("Développement en deux parties");
    await expect(line(page, 3).slides).toHaveValue("4");
    await expect(main(page).getByRole("textbox", { name: "Ton" })).toHaveValue(/professionnel/i);

    await main(page).getByRole("button", { name: "Enregistrer la trame" }).click();
    await expect(main(page).getByText("Trame enregistrée.")).toBeVisible();
    await page.reload();
    await expect(lineTitles(page)).toHaveCount(4);
    await expect(slidesTab(page)).toHaveAccessibleName("Diapos : Personnalisée");
  });

  test("devrait lire un tableau de diapos avec plages, contenu type et durées", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame tableau");
    await openStep(page, id, "trame");
    const table = [
      "| Diapo | Titre | Contenu type | Durée |",
      "|-------|-------|--------------|-------|",
      "| 1 | Titre | La problématique tirée, mon nom, la date | 0:30 |",
      "| 2-3 | Contexte | Pourquoi la question se pose : enjeu, deux chiffres clés sourcés | 3:00 |",
      "| 4-5 | État des lieux | Acteurs, contraintes, risques ; un schéma si possible | 4:00 |",
      "| 6-8 | Pistes | Deux ou trois solutions, avec avantages et limites | 6:00 |",
      "| 9 | Recommandation | La piste retenue, sa mise en œuvre et son coût | 3:30 |",
      "| 10 | Conclusion | Réponse directe à la problématique, puis une ouverture | 3:00 |",
    ].join("\n");
    const region = promptRegion(page);
    await region.getByLabel("Consignes ou prompt").fill(table);
    await region.getByRole("button", { name: "Analyser le prompt" }).click();
    const preview = region.getByRole("region", { name: "Trame proposée" });
    await expect(proposedLines(preview)).toHaveText([
      "Contexte — 2 diapos · 3:00",
      "État des lieux — 2 diapos · 4:00",
      "Pistes — 3 diapos · 6:00",
      "Recommandation — 1 diapo · 3:30",
      "Conclusion — 1 diapo · 3:00",
    ]);
    await expect(preview).toContainText("20 min");

    await preview.getByRole("button", { name: "Appliquer à la trame" }).click();
    await expect(lineTitles(page)).toHaveCount(5);
    await expect(line(page, 1).guidance).toHaveValue("Pourquoi la question se pose : enjeu, deux chiffres clés sourcés");
    await expect(line(page, 4).duration).toHaveValue("3:30");
    await expect(line(page, 3).slides).toHaveValue("3");
  });

  test("devrait charger un fichier .txt dans le champ et reconnaître les 4 lignes", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame fichier");
    await openStep(page, id, "trame");
    const region = promptRegion(page);
    await region.locator('input[type="file"]').setInputFiles(FILES.promptTxt);
    await expect(region.getByLabel("Consignes ou prompt")).toHaveValue(TEMPLATE_PROMPT + "\n");
    await region.getByRole("button", { name: "Analyser le prompt" }).click();
    await expectFourSections(region.getByRole("region", { name: "Trame proposée" }));
  });
});

test.describe("5. Trame — limites et passage au Jour J", () => {
  test("devrait refuser une trame de plus de 60 diapos, puis accepter 60", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame 61 diapos");
    await openStep(page, id, "trame");
    const counts = main(page).getByRole("spinbutton", { name: /^Nombre de diapos de la ligne \d+$/ });
    await expect(counts).toHaveCount(7);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await line(page, n).slides.fill("8"); // 1 + 56 = 57
    await main(page).getByRole("button", { name: "Ajouter une ligne" }).click();
    await expect(line(page, 8).title).toHaveValue("Nouvelle ligne");
    await line(page, 8).slides.fill("4"); // 61
    await main(page).getByRole("button", { name: "Enregistrer la trame" }).click();
    await expect(main(page).getByText("La trame dépasse 60 diapos : réduisez le nombre de diapos par ligne.")).toBeVisible();

    await line(page, 8).slides.fill("3"); // 60 : accepté
    await main(page).getByRole("button", { name: "Enregistrer la trame" }).click();
    await expect(main(page).getByText("Trame enregistrée.")).toBeVisible();
  });

  test("devrait refuser une durée d'oral de 2 minutes et 9 diapos sur une ligne", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Trame invalide");
    await openStep(page, id, "trame");
    await main(page).getByRole("spinbutton", { name: "Durée de l'oral (minutes)" }).fill("2");
    await line(page, 1).slides.fill("9");
    await main(page).getByRole("button", { name: "Enregistrer la trame" }).click();
    await expect(main(page).getByText("L'oral dure au moins 3 minutes.")).toBeVisible();
    await expect(main(page).getByText("Une ligne compte au plus 8 diapos.")).toBeVisible();
  });

  test("devrait mener de la Trame au Jour J (sujets en lien facultatif), sans sujet ni étape bloquée", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Vers le Jour J");
    await openStep(page, id, "trame");
    await expect(projectSteps(page)).not.toContainText("bloquée");
    const bar = page.getByRole("navigation", { name: "Étapes précédente et suivante" });
    await expect(bar.getByRole("link", { name: "Ajouter des sujets (facultatif)" })).toHaveAttribute("href", `/projets/${id}/trame/sujets`);
    await bar.getByRole("link", { name: "Étape suivante : Jour J" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/jour-j`);
  });
});

test.describe("5. Apparence — enregistrement et validations", () => {
  test("devrait enregistrer le nom de l'apparence et passer l'étape en « Personnalisée »", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Apparence nommée");
    await openStep(page, id, "apparence");
    const appearance = projectSteps(page).getByRole("link", { name: /^Étape 1 : Apparence/ });
    // L'apparence par défaut est utilisable : l'étape est faite, son résumé dit « Par défaut ».
    await expect(appearance).toHaveAccessibleName(/Apparence, Par défaut — faite/);
    await main(page).getByLabel("Nom de l'apparence").fill("Couleurs du master");
    await main(page).getByRole("button", { name: "Enregistrer l'apparence" }).click();
    await expect(main(page).getByText("Apparence enregistrée.")).toBeVisible();
    await page.reload();
    await expect(main(page).getByLabel("Nom de l'apparence")).toHaveValue("Couleurs du master");
    await expect(appearance).toHaveAccessibleName(/Apparence, Personnalisée — faite/);
  });

  test("devrait refuser une couleur hexadécimale invalide", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Couleur invalide");
    await openStep(page, id, "apparence");
    const primary = main(page).getByRole("textbox", { name: "Principale (hexadécimal)" });
    await primary.fill("#12");
    await main(page).getByRole("button", { name: "Enregistrer l'apparence" }).click();
    await expect(main(page).getByText("Couleur attendue au format #RRGGBB (ex. #1F4E79).")).toBeVisible();
    await expect(primary).toHaveAttribute("aria-invalid", "true");
    await page.reload();
    await expect(main(page).getByRole("textbox", { name: "Principale (hexadécimal)" })).toHaveValue("#1E3A5F");
  });
});
