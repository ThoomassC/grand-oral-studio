import { test, expect, OLLAMA_CONFIGURED, OLLAMA_SKIP_REASON } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const OLLAMA_MODEL = "qwen2.5:14b";

/** Bandeau d'état en tête de page : « Le jour J, vos diaporamas sont rédigés par … ». */
function writerBanner(page: Page) {
  return page.getByRole("main").getByText(/^Le jour J, vos diaporamas sont rédigés par/);
}

function engineGroup(page: Page) {
  return page.getByRole("main").getByRole("radiogroup", { name: "1. Qui rédige le jour J ?" });
}

function radio(page: Page, name: string) {
  return engineGroup(page).getByRole("radio", { name, exact: true });
}

test.describe("3. Configuration IA — page guidée", () => {
  test("devrait s'intituler Configuration IA, en une colonne et sans sommaire latéral", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await expect(page).toHaveTitle(/^Configuration IA · Grand Oral Studio$/);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Configuration IA", level: 1 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "1. Qui rédige le jour J ?", level: 2 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Apparence" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: /Sommaire/ })).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Configuration IA" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("devrait annoncer la rédaction en démo, prête, avec Claude coché et sa connexion ouverte (AI_PROVIDER=mock)", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await expect(writerBanner(page)).toContainText("Démo (contenus factices)");
    await expect(main.getByText("Prêt", { exact: true })).toBeVisible();
    await expect(radio(page, "Sans IA")).toBeEnabled();
    await expect(radio(page, "Claude")).toBeChecked();
    await expect(main.getByRole("heading", { name: "2. Connecter Claude", level: 2 })).toBeVisible();
    await expect(main.getByText("Mode démonstration : aucune clé nécessaire.")).toBeVisible();
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

test.describe("3. Configuration IA — qui rédige le jour J", () => {
  test("devrait enregistrer Sans IA, masquer la connexion de Claude et garder le choix après rechargement", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await radio(page, "Sans IA").check();
    await expect(main.getByRole("heading", { name: "2. Connecter Claude" })).toHaveCount(0);
    await main.getByRole("button", { name: "Choisir Sans IA" }).click();
    await expect(main.getByText("Choix enregistré : Sans IA.")).toBeVisible();
    await page.reload();
    await expect(writerBanner(page)).toContainText("Sans IA");
    await expect(radio(page, "Sans IA")).toBeChecked();
    await expect(main.getByRole("button", { name: /^Choisir / })).toHaveCount(0);
  });

  test("devrait revenir à Claude (démo) après Sans IA", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await radio(page, "Sans IA").check();
    await main.getByRole("button", { name: "Choisir Sans IA" }).click();
    await expect(main.getByText("Choix enregistré : Sans IA.")).toBeVisible();
    await radio(page, "Claude").check();
    await main.getByRole("button", { name: "Choisir Claude" }).click();
    await expect(main.getByText("Choix enregistré : Claude.")).toBeVisible();
    await page.reload();
    await expect(writerBanner(page)).toContainText("Démo (contenus factices)");
    await expect(radio(page, "Claude")).toBeChecked();
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
    await expect(writerBanner(page)).toContainText(`Ollama · ${OLLAMA_MODEL}`);
    await expect(radio(page, "Modèle local (Ollama)")).toBeChecked();
    await expect(main.getByLabel("Modèle", { exact: true })).toHaveValue(OLLAMA_MODEL);
  });
});

test.describe("3. Configuration IA — connecter Claude", () => {
  for (const [label, value, message] of [
    ["sans préfixe", "abc-pas-une-cle-valide-du-tout", "Une clé API Anthropic commence par « sk-ant- »."],
    ["trop courte", "sk-ant-court", "Cette clé est trop courte : copiez-la en entier."],
    ["avec espace", "sk-ant-api03-abcdef ghijklmnopqrstu", "La clé ne doit contenir que des lettres"],
  ] as const) {
    test(`devrait refuser une clé ${label} sans appeler le serveur`, async ({ page, account }) => {
      void account;
      await page.goto("/configuration-ia");
      const actions: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && r.headers()["next-action"]) actions.push(r.url());
      });
      const form = page.getByRole("main").getByRole("form", { name: "Connecter Claude avec votre clé API" });
      const field = form.getByLabel("Clé API Anthropic", { exact: true });
      await field.fill(value);
      await form.getByRole("button", { name: "Vérifier et activer" }).click();
      await expect(form.getByText("La clé saisie n'a pas le bon format.")).toBeVisible();
      await expect(form.getByText(message)).toBeVisible();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toBeFocused();
      expect(actions, "aucune Server Action ne doit partir").toEqual([]);
    });
  }

  test("devrait rappeler que la clé est chiffrée et jamais réaffichée, avec le lien vers la console Anthropic", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const main = page.getByRole("main");
    await expect(main.getByText("Chiffrée, jamais réaffichée : seuls les 4 derniers caractères restent visibles.")).toBeVisible();
    await expect(main.getByRole("link", { name: /console Anthropic, rubrique API Keys/ })).toHaveAttribute(
      "href",
      "https://console.anthropic.com/settings/keys",
    );
  });
});
