import { test, expect, OLLAMA_CONFIGURED, OLLAMA_SKIP_REASON } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const OLLAMA_MODEL = "qwen2.5:14b";
/** En démo (AI_PROVIDER=mock), la carte « Démo » est le choix par défaut (Claude n'est plus proposé depuis la 1.2). */
const DEMO = "Démo (contenus factices)";

function engineGroup(page: Page) {
  return page.getByRole("main").getByRole("radiogroup", { name: "1. Qui rédige le jour J ?" });
}

function radio(page: Page, name: string) {
  return engineGroup(page).getByRole("radio", { name, exact: true });
}

test.describe("3. Rédaction IA — page guidée", () => {
  test("devrait s'intituler Rédaction IA, en une colonne et sans sommaire latéral", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await expect(page).toHaveTitle(/^Rédaction IA · Grand Oral Studio$/);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Rédaction IA", level: 1 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "1. Qui rédige le jour J ?", level: 2 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Apparence" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: /Sommaire/ })).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Rédaction IA" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("devrait présenter les choix en cartes côte à côte, détail écrit dedans, cochables d'un clic sur la carte", async ({ page, account }) => {
    void account;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/configuration-ia");
    const card = (name: string) => page.locator("[data-engine-card]").filter({ has: page.getByRole("radio", { name, exact: true }) });
    await expect(card("Gemini").getByText("Coût")).toBeVisible();
    await expect(card("Gemini").getByText(/palier gratuit de Google AI Studio/)).toBeVisible();
    await expect(card("Sans IA").getByText("Vos données")).toBeVisible();
    // Côte à côte : les deux premières cartes (Sans IA, puis Démo en AI_PROVIDER=mock)
    // partent de la même hauteur, l'une à droite de l'autre.
    const [a, b] = await Promise.all([card("Sans IA").boundingBox(), card(DEMO).boundingBox()]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(b!.x).toBeGreaterThan(a!.x + a!.width);
    await card("Sans IA").getByText("Vos données").click();
    await expect(radio(page, "Sans IA")).toBeChecked();
    await expect(page.getByRole("main").getByRole("button", { name: /^En savoir plus : (Sans IA|Gemini)$/ })).toHaveCount(0);
  });

  test("devrait empiler les cartes à 375 px et replier le détail derrière « Afficher le détail »", async ({ page, account }) => {
    void account;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/configuration-ia");
    const card = page.locator("[data-engine-card]").filter({ has: page.getByRole("radio", { name: "Gemini", exact: true }) });
    await expect(card.getByText("Coût")).toBeHidden();
    await card.getByRole("button", { name: "Afficher le détail : Gemini" }).click();
    await expect(card.getByText("Coût")).toBeVisible();
    await expect(card.getByRole("button", { name: "Masquer le détail : Gemini" })).toHaveAttribute("aria-expanded", "true");
  });

  test("devrait faire apparaître « 2. Connecter Gemini » quand on coche Gemini, et le retirer avec Sans IA", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    const q2 = main.getByRole("heading", { name: "2. Connecter Gemini", level: 2 });
    await radio(page, "Sans IA").check();
    await expect(q2).toHaveCount(0);
    await radio(page, "Gemini").check();
    await expect(q2).toBeVisible();
    await expect(page.getByText("Étape 2 affichée plus bas : connectez Gemini.")).toBeAttached();
  });

  test("devrait cocher la démo par défaut, sans carte Claude ni OpenAI ni connexion à ouvrir (AI_PROVIDER=mock)", async ({
    page,
    account,
  }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await expect(main.getByText(/rédigés par/)).toHaveCount(0);
    await expect(radio(page, "Sans IA")).toBeEnabled();
    await expect(radio(page, DEMO)).toBeChecked();
    await expect(engineGroup(page).getByRole("radio", { name: /Claude|OpenAI/ })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: /^2\. Connecter/, level: 2 })).toHaveCount(0);
    await expect(main.getByText(/Mode démonstration/)).toHaveCount(0);
    // Le choix coché est déjà celui en vigueur : aucun bouton d'enregistrement.
    await expect(main.getByRole("button", { name: /^Choisir / })).toHaveCount(0);
  });

  test("devrait présenter le modèle local seulement si Ollama est configuré sur le serveur", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await expect(radio(page, "Sans IA")).toBeVisible();
    await expect(radio(page, "Modèle local (Ollama)")).toHaveCount(OLLAMA_CONFIGURED ? 1 : 0);
  });
});

test.describe("3. Rédaction IA — qui rédige le jour J", () => {
  test("devrait enregistrer Sans IA, sans question 2, et garder le choix après rechargement", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await radio(page, "Sans IA").check();
    await expect(main.getByRole("heading", { name: /^2\. Connecter/ })).toHaveCount(0);
    await main.getByRole("button", { name: "Choisir Sans IA" }).click();
    await expect(main.getByText("Choix enregistré : Sans IA.")).toBeVisible();
    await page.reload();
    await expect(radio(page, "Sans IA")).toBeChecked();
    await expect(main.getByRole("button", { name: /^Choisir / })).toHaveCount(0);
  });

  test("devrait revenir à la démo après Sans IA", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await radio(page, "Sans IA").check();
    await main.getByRole("button", { name: "Choisir Sans IA" }).click();
    await expect(main.getByText("Choix enregistré : Sans IA.")).toBeVisible();
    await radio(page, DEMO).check();
    await main.getByRole("button", { name: `Choisir ${DEMO}` }).click();
    await expect(main.getByText(`Choix enregistré : ${DEMO}.`)).toBeVisible();
    await page.reload();
    await expect(radio(page, DEMO)).toBeChecked();
  });

  test(`devrait proposer le modèle ${OLLAMA_MODEL} et enregistrer Ollama`, async ({ page, account }) => {
    void account;
    test.skip(!OLLAMA_CONFIGURED, OLLAMA_SKIP_REASON);
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await radio(page, "Modèle local (Ollama)").check();
    const select = main.getByLabel("Modèle", { exact: true });
    await expect(select.locator("option", { hasText: OLLAMA_MODEL })).toHaveCount(1);
    await select.selectOption(OLLAMA_MODEL);
    await main.getByRole("button", { name: "Choisir ce modèle" }).click();
    await expect(main.getByText(`Choix enregistré : Ollama · ${OLLAMA_MODEL}.`)).toBeVisible();
    await page.reload();
    await expect(radio(page, "Modèle local (Ollama)")).toBeChecked();
    await expect(main.getByLabel("Modèle", { exact: true })).toHaveValue(OLLAMA_MODEL);
  });
});

test.describe("3. Rédaction IA — connecter Gemini", () => {
  test("devrait refuser une clé vide sans appeler le serveur", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await radio(page, "Gemini").check();
    const actions: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actions.push(r.url());
    });
    const form = page.getByRole("main").getByRole("form", { name: "Connecter Gemini avec votre clé API" });
    const field = form.getByLabel("Clé API Gemini", { exact: true });
    await form.getByRole("button", { name: "Vérifier et activer" }).click();
    await expect(form.getByText("La clé saisie n'a pas le bon format.")).toBeVisible();
    await expect(form.getByText("Saisissez votre clé API Gemini.")).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toBeFocused();
    expect(actions, "aucune Server Action ne doit partir").toEqual([]);
  });

  test("devrait refuser côté serveur une clé de forme invalide, sur le champ, sans la vérifier auprès de Google", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await radio(page, "Gemini").check();
    const form = page.getByRole("main").getByRole("form", { name: "Connecter Gemini avec votre clé API" });
    const field = form.getByLabel("Clé API Gemini", { exact: true });
    await field.fill("abc-pas-une-cle-valide-du-tout");
    await form.getByRole("button", { name: "Vérifier et activer" }).click();
    await expect(form.getByText(/Ce n'est pas une clé API Gemini valide\./)).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
  });

  test("devrait rappeler, derrière le « i », que la clé est chiffrée et jamais réaffichée, avec le lien vers Google AI Studio", async ({
    page,
    account,
  }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await radio(page, "Gemini").check();
    await main.getByRole("button", { name: "En savoir plus : Votre clé API" }).click();
    await expect(page.getByRole("dialog", { name: "Votre clé API" }).getByText(/chiffrée et n'est jamais réaffichée/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(main.getByRole("link", { name: /Google AI Studio, rubrique API Keys/ })).toHaveAttribute(
      "href",
      "https://aistudio.google.com/apikey",
    );
  });
});

test.describe("3. Rédaction IA — autres fournisseurs et connexions", () => {
  test("devrait proposer Mistral et Gemini, sans Claude ni OpenAI, et connecter Mistral avec l'avertissement Privacy", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    for (const name of ["Mistral", "Gemini"]) await expect(radio(page, name)).toBeVisible();
    for (const name of ["Claude", "OpenAI", "Claude, clé de l'équipe", "OpenAI, clé de l'équipe"]) await expect(radio(page, name)).toHaveCount(0);
    await radio(page, "Mistral").check();
    await expect(main.getByRole("heading", { name: "2. Connecter Mistral", level: 2 })).toBeVisible();
    await expect(main.getByText(/Admin Console › Privacy/)).toBeVisible();
    await expect(main.getByRole("link", { name: /console Mistral/ })).toHaveAttribute("href", "https://console.mistral.ai/api-keys");
    await expect(main.getByLabel("Modèle", { exact: true })).toHaveValue("mistral-large-latest");

    const actions: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actions.push(r.url());
    });
    const form = main.getByRole("form", { name: "Connecter Mistral avec votre clé API" });
    await form.getByRole("button", { name: "Vérifier et activer" }).click();
    await expect(form.getByText("Saisissez votre clé API Mistral.")).toBeVisible();
    expect(actions, "aucune Server Action ne doit partir").toEqual([]);
  });

  test("devrait présenter « Mes connexions », vide pour un compte neuf", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const section = page.getByRole("main").getByRole("region", { name: "Mes connexions" });
    await expect(section.getByText("Aucune clé enregistrée. Cochez Mistral ou Gemini ci-dessus pour connecter la vôtre.")).toBeVisible();
  });
});
