import { expect, type Locator, type Page } from "@playwright/test";

/** Helpers de parcours : passent par l'interface, comme un utilisateur. */

/** Ouvre la modale « Nouveau projet » depuis /projets (bouton à côté du titre) ; renvoie la modale. */
export async function openNewProjectDialog(page: Page): Promise<Locator> {
  await page.goto("/projets");
  const trigger = page.getByRole("main").getByRole("button", { name: "Nouveau projet" });
  await waitForHydration(trigger);
  await trigger.click();
  const modal = dialog(page, "Nouveau projet");
  await expect(modal.getByLabel("Nom du projet")).toBeFocused();
  return modal;
}

export async function createProject(page: Page, name: string, description = ""): Promise<string> {
  const modal = await openNewProjectDialog(page);
  await modal.getByLabel("Nom du projet").fill(name);
  if (description) await modal.getByLabel(/^Description/).fill(description);
  await modal.getByRole("button", { name: "Créer le projet" }).click();
  // La création ouvre l'étape 1 · Apparence (v1.1.0).
  await page.waitForURL(/\/projets\/[a-z0-9]+\/apparence$/);
  await expect(page.getByRole("main").getByRole("heading", { name: "Apparence", level: 2 })).toBeVisible();
  return projectIdFromUrl(page.url());
}

/**
 * Attend que React ait pris la main sur l'élément (hydratation terminée) :
 * avant, une saisie peut être perdue. Le parcours Jour J, par exemple, remonte
 * son formulaire une fois côté client pour restaurer le brouillon ; sur une
 * machine lente (CI, `next dev` à froid), Playwright a le temps de remplir le
 * champ rendu par le serveur, que ce remontage efface.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), {
      message: "hydratation React de l'élément",
      timeout: 30_000,
    })
    .toBe(true);
}

/** Ouvre le Jour J d'un projet, formulaire hydraté (cf. waitForHydration). */
export async function openDayJourney(page: Page, programId: string): Promise<void> {
  await page.goto(`/projets/${programId}/jour-j`);
  await waitForHydration(page.getByRole("main").getByLabel("Problématique tirée au sort"));
}

export function projectIdFromUrl(url: string): string {
  const m = /\/projets\/([a-z0-9]+)/.exec(url);
  if (!m?.[1]) throw new Error(`URL de projet inattendue : ${url}`);
  return m[1];
}

export const DEFAULT_THEMES = `Cybersécurité | Protection des systèmes et des données | attaque, rançongiciel, données, sécurité, piratage
Transformation numérique | Numérisation des organisations | digital, numérique, outils, cloud, organisation
Intelligence artificielle | Apprentissage automatique et éthique | IA, algorithme, apprentissage, modèle, éthique`;

/** Import de la liste texte (format pipe) depuis l'onglet Sujets de la Trame. */
export async function importThemeList(page: Page, programId: string, text = DEFAULT_THEMES): Promise<void> {
  await page.goto(`/projets/${programId}/trame/sujets`);
  const main = page.getByRole("main");
  const trigger = main.getByRole("button", { name: "Importer une liste" });
  await waitForHydration(trigger);
  await trigger.click();
  await main.getByLabel("Liste des sujets").fill(text);
  await main.getByRole("button", { name: "Importer les sujets" }).click();
  await expect(main.getByText(/^\d+ sujets? créés?\.$|^Aucun nouveau sujet créé\.$/)).toBeVisible();
}

export type EngineChoice = "free" | "demo" | "ollama";

const ENGINE_RADIO: Record<EngineChoice, string> = {
  free: "Sans IA",
  demo: "Démo (contenus factices)",
  ollama: "Modèle local (Ollama)",
};

/** Choisit et enregistre le rédacteur (page Rédaction IA). `demo` = moteur démo (AI_PROVIDER=mock). */
export async function setEngine(page: Page, engine: EngineChoice, ollamaModel?: string): Promise<void> {
  await page.goto("/configuration-ia");
  const main = page.getByRole("main");
  const radio = main.getByRole("radio", { name: ENGINE_RADIO[engine], exact: true });
  await waitForHydration(radio);
  await radio.check();
  if (engine === "ollama" && ollamaModel) await main.getByLabel("Modèle", { exact: true }).selectOption(ollamaModel);
  const save = main.getByRole("button", { name: /^Choisir / });
  // Choix déjà enregistré : aucun bouton à cliquer.
  if ((await save.count()) === 0) return;
  await save.click();
  await expect(main.getByText(/^Choix enregistré :/)).toBeVisible();
}

export async function generateMissingSkeletons(page: Page, programId: string, timeout = 60_000): Promise<void> {
  await page.goto(`/projets/${programId}/squelettes`);
  await page.getByRole("button", { name: /Générer les squelettes manquants/ }).click();
  await expect(page.locator("p").getByText(/^\d+ squelettes? générés?\.$/)).toBeVisible({ timeout });
}

/** Parcours Jour J avec thème indiqué → génère et attend la page du deck. Renvoie l'id du deck. */
export async function generateFinalDeck(page: Page, programId: string, problem: string, themeName: string): Promise<string> {
  await openDayJourney(page, programId);
  // Portée <main> : juste après une navigation, le streaming peut laisser une copie masquée hors de <main>.
  const main = page.getByRole("main");
  await main.getByLabel("Problématique tirée au sort").fill(problem);
  await main.getByLabel(/Thème indiqué sur le sujet/).selectOption({ label: themeName });
  await main.getByRole("button", { name: "Continuer avec ce thème" }).click();
  await main.getByRole("button", { name: "Générer le diaporama" }).click();
  await page.waitForURL(/\/decks\/[a-z0-9]+\?nouveau=1/, { timeout: 90_000 });
  const m = /\/decks\/([a-z0-9]+)/.exec(page.url());
  return m![1]!;
}

export function dialog(page: Page, name: string | RegExp): Locator {
  return page.getByRole("dialog", { name });
}

/** Ouvre le menu « ⋮ » d'une ligne de /projets et active l'entrée demandée. */
export async function projectRowAction(page: Page, projectName: string, action: "Dupliquer" | "Supprimer"): Promise<void> {
  const trigger = page.getByRole("button", { name: `Actions du projet ${projectName}`, exact: true });
  await waitForHydration(trigger);
  await trigger.click();
  await page.getByRole("menu", { name: `Actions du projet ${projectName}`, exact: true }).getByRole("menuitem", { name: action }).click();
}
