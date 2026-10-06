import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { openDayJourney, waitForHydration } from "./app";
import { query } from "./db";

/**
 * Helpers du parcours 1.1.0 (Apparence → Trame → Jour J, Decks à part), utilisés
 * par les specs 06 à 13 en complément de `app.ts` (createProject, importThemeList).
 * Passent par l'interface, sauf `seedLegacySkeleton` :
 * les squelettes ne se génèrent plus depuis la 1.1.0, seule la base peut encore
 * en contenir (projets créés en 1.0).
 */

/** Lignes de sujets au format d'import « Nom | description | mots-clés | notes ». */
export const SUBJECTS = {
  cyber: "Cybersécurité | Protection des systèmes et des données | attaque, rançongiciel, données, sécurité, piratage | 60 % des PME touchées en 2025",
  digital: "Transformation numérique | Numérisation des organisations | digital, numérique, outils, cloud, organisation |",
  ai: "Intelligence artificielle | Apprentissage automatique et éthique | IA, algorithme, apprentissage, modèle, éthique |",
} as const;

/**
 * Choisit « Sans IA » pour rédiger le jour J (Configuration IA). Sans choix
 * enregistré, un serveur en AI_PROVIDER=mock rédige en « Démo » : c'est l'état
 * d'un compte neuf, rien à faire pour le moteur démo.
 */
export async function chooseFreeWriter(page: Page): Promise<void> {
  await page.goto("/configuration-ia");
  const main = page.getByRole("main");
  const radio = main.getByRole("radio", { name: "Sans IA", exact: true });
  await waitForHydration(radio);
  await radio.check();
  await main.getByRole("button", { name: "Choisir Sans IA" }).click();
  await expect(main.getByText("Choix enregistré : Sans IA.")).toBeVisible();
}

/**
 * Parcours Jour J jusqu'à la page du nouveau deck. `subject` : nom du sujet à
 * retenir (projet à un sujet ou sujet indiqué sur l'énoncé), ou `null` pour un
 * projet sans sujet. Renvoie l'id du deck.
 */
export async function generateDeck(
  page: Page,
  programId: string,
  problem: string,
  subject: string | null,
  timeout = 90_000,
): Promise<string> {
  await openDayJourney(page, programId);
  // Portée <main> : juste après une navigation, le streaming peut laisser une copie masquée hors de <main>.
  const main = page.getByRole("main");
  await main.getByLabel("Problématique tirée au sort").fill(problem);
  const hint = main.getByLabel(/Sujet indiqué sur l'énoncé/);
  if (subject !== null && (await hint.count()) > 0) {
    await hint.selectOption({ label: subject });
    await main.getByRole("button", { name: "Continuer avec ce sujet" }).click();
  } else {
    await main.getByRole("button", { name: "Continuer", exact: true }).click();
  }
  await main.getByRole("button", { name: "Générer le diaporama" }).click();
  await page.waitForURL(/\/decks\/[a-z0-9]+\?nouveau=1$/, { timeout });
  const m = /\/decks\/([a-z0-9]+)/.exec(page.url());
  return m![1]!;
}

/**
 * Sème en base un squelette de la version 1.0, copié d'un deck final qui a un
 * sujet (spec valide garantie). Renvoie l'id du squelette.
 */
export async function seedLegacySkeleton(fromDeckId: string, title: string): Promise<string> {
  const id = `e2eskel${randomUUID().replace(/-/g, "").slice(0, 17)}`;
  const rows = await query<{ id: string }>(
    `insert into "Deck" ("id", "programId", "themeId", "kind", "problem", "spec", "engine", "createdAt", "updatedAt")
     select $1, "programId", "themeId", 'SKELETON', null, jsonb_set("spec", '{title}', to_jsonb($2::text)), 'free', now(), now()
     from "Deck" where "id" = $3 and "themeId" is not null
     returning "id"`,
    [id, title, fromDeckId],
  );
  if (rows.length !== 1) throw new Error(`Squelette non semé : le deck ${fromDeckId} est introuvable ou sans sujet.`);
  return id;
}
