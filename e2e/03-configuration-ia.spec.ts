import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const OLLAMA_MODEL = "qwen2.5:14b";

function effective(page: Page) {
  return page.getByRole("region", { name: "Moteur de rédaction" }).getByText(/^Moteur utilisé :/);
}

test.describe("3. Configuration IA — sommaire", () => {
  test("devrait s'intituler Configuration IA, sans section Apparence", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await expect(page).toHaveTitle(/^Configuration IA · Grand Oral Studio$/);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Configuration IA", level: 1 })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Apparence" })).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Configuration IA" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("devrait aller à la section Clé API au clic dans le sommaire", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const toc = page.getByRole("navigation", { name: "Sommaire de la configuration IA" });
    await expect(toc.getByRole("link")).toHaveText([/Moteur de rédaction/, /Clé API Anthropic/]);
    await toc.getByRole("link", { name: "Clé API Anthropic" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/configuration-ia#cle-api`);
    const heading = page.getByRole("main").getByRole("heading", { name: "Clé API Anthropic", level: 2 });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  });

  test("ne devrait proposer ni titre « Sommaire » ni bouton de pli dans le rail", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    const toc = page.getByRole("navigation", { name: "Sommaire de la configuration IA" });
    await expect(toc.getByRole("link", { name: "Moteur de rédaction" })).toBeVisible();
    await expect(page.getByRole("button", { name: /(Replier|Déplier) le sommaire/ })).toHaveCount(0);
    // Le bouton « Sommaire » du format mobile d'Opale existe (masqué) : seul le titre est visé.
    await expect(page.getByRole("main").locator(".settings-rail p", { hasText: /^Sommaire$/ })).toHaveCount(0);
  });
});

test.describe("3. Configuration IA — moteur", () => {
  test("devrait proposer Gratuit, Claude (démo, AI_PROVIDER=mock) et Ollama disponibles", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await expect(effective(page)).toContainText("Démo (contenus factices)");
    await expect(page.getByRole("radio", { name: "Gratuit (sans IA)" })).toBeEnabled();
    // Sans clé mais AI_PROVIDER=mock : Claude est servi par le mock, donc disponible.
    await expect(page.getByRole("radio", { name: "Claude (Anthropic)" })).toBeEnabled();
    await expect(page.getByRole("radio", { name: "Modèle local (Ollama)" })).toBeEnabled();
  });

  test("devrait enregistrer le moteur Gratuit et le garder après rechargement", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await page.getByRole("radio", { name: "Gratuit (sans IA)" }).check();
    await page.getByRole("button", { name: "Enregistrer le moteur" }).click();
    await expect(page.getByText("Moteur enregistré : Gratuit (sans IA).")).toBeVisible();
    await page.reload();
    await expect(effective(page)).toContainText("Gratuit (sans IA)");
    await expect(page.getByRole("radio", { name: "Gratuit (sans IA)" })).toBeChecked();
  });

  test(`devrait proposer le modèle ${OLLAMA_MODEL} et enregistrer Ollama`, async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await page.getByRole("radio", { name: "Modèle local (Ollama)" }).check();
    const select = page.getByLabel("Modèle Ollama");
    await expect(select.locator("option", { hasText: OLLAMA_MODEL })).toHaveCount(1);
    await select.selectOption(OLLAMA_MODEL);
    await page.getByRole("button", { name: "Enregistrer le moteur" }).click();
    await expect(page.getByText(`Moteur enregistré : Modèle local (Ollama · ${OLLAMA_MODEL}).`)).toBeVisible();
    await page.reload();
    await expect(effective(page)).toContainText(`Modèle local (Ollama · ${OLLAMA_MODEL})`);
    await expect(page.getByRole("radio", { name: "Modèle local (Ollama)" })).toBeChecked();
    await expect(page.getByLabel("Modèle Ollama")).toHaveValue(OLLAMA_MODEL);
  });

  test("devrait revenir au moteur Claude (démo) après Gratuit", async ({ page, account }) => {
    void account;
    await page.goto("/configuration-ia");
    await page.getByRole("radio", { name: "Gratuit (sans IA)" }).check();
    await page.getByRole("button", { name: "Enregistrer le moteur" }).click();
    await expect(page.getByText("Moteur enregistré : Gratuit (sans IA).")).toBeVisible();
    await page.getByRole("radio", { name: "Claude (Anthropic)" }).check();
    await page.getByRole("button", { name: "Enregistrer le moteur" }).click();
    await expect(page.getByText("Moteur enregistré : Claude (Anthropic).")).toBeVisible();
    await page.reload();
    await expect(effective(page)).toContainText("Démo (contenus factices)");
  });
});

test.describe("3. Configuration IA — clé API", () => {
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
      const field = page.getByLabel("Votre clé API Anthropic");
      await field.fill(value);
      await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
      await expect(page.getByText("La clé saisie n'a pas le bon format.")).toBeVisible();
      await expect(page.getByText(message)).toBeVisible();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toBeFocused();
      expect(actions, "aucune Server Action ne doit partir").toEqual([]);
    });
  }
});
