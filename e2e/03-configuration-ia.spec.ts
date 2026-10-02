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

test.describe("3. Paramètres — sommaire", () => {
  test("devrait aller à la section Apparence au clic dans le sommaire", async ({ page, account }) => {
    void account;
    await page.goto("/parametres");
    const toc = page.getByRole("navigation", { name: "Sommaire des paramètres" });
    await toc.getByRole("link", { name: "Apparence" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/parametres#apparence`);
    await expect(page.getByRole("heading", { name: "Apparence", level: 2 })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Apparence", level: 2 })).toBeInViewport();
  });

  test("devrait replier puis déplier le sommaire et garder l'état après rechargement", async ({ page, account }) => {
    void account;
    await page.goto("/parametres");
    await page.getByRole("button", { name: "Replier le sommaire" }).click();
    const unfold = page.getByRole("button", { name: "Déplier le sommaire" });
    await expect(unfold).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(page.getByRole("button", { name: "Déplier le sommaire" })).toBeVisible();
    await page.getByRole("button", { name: "Déplier le sommaire" }).click();
    await expect(page.getByRole("button", { name: "Replier le sommaire" })).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("3. Paramètres — moteur", () => {
  test("devrait proposer Gratuit, Claude (démo, AI_PROVIDER=mock) et Ollama disponibles", async ({ page, account }) => {
    void account;
    await page.goto("/parametres");
    await expect(effective(page)).toContainText("Démo (contenus factices)");
    await expect(page.getByRole("radio", { name: "Gratuit (sans IA)" })).toBeEnabled();
    // Sans clé mais AI_PROVIDER=mock : Claude est servi par le mock, donc disponible.
    await expect(page.getByRole("radio", { name: "Claude (Anthropic)" })).toBeEnabled();
    await expect(page.getByRole("radio", { name: "Modèle local (Ollama)" })).toBeEnabled();
  });

  test("devrait enregistrer le moteur Gratuit et le garder après rechargement", async ({ page, account }) => {
    void account;
    await page.goto("/parametres");
    await page.getByRole("radio", { name: "Gratuit (sans IA)" }).check();
    await page.getByRole("button", { name: "Enregistrer le moteur" }).click();
    await expect(page.getByText("Moteur enregistré : Gratuit (sans IA).")).toBeVisible();
    await page.reload();
    await expect(effective(page)).toContainText("Gratuit (sans IA)");
    await expect(page.getByRole("radio", { name: "Gratuit (sans IA)" })).toBeChecked();
  });

  test(`devrait proposer le modèle ${OLLAMA_MODEL} et enregistrer Ollama`, async ({ page, account }) => {
    void account;
    await page.goto("/parametres");
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
    await page.goto("/parametres");
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

test.describe("3. Paramètres — clé API", () => {
  for (const [label, value, message] of [
    ["sans préfixe", "abc-pas-une-cle-valide-du-tout", "Une clé API Anthropic commence par « sk-ant- »."],
    ["trop courte", "sk-ant-court", "Cette clé est trop courte : copiez-la en entier."],
    ["avec espace", "sk-ant-api03-abcdef ghijklmnopqrstu", "La clé ne doit contenir que des lettres"],
  ] as const) {
    test(`devrait refuser une clé ${label} sans appeler le serveur`, async ({ page, account }) => {
      void account;
      await page.goto("/parametres");
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

test.describe("3. Paramètres — apparence", () => {
  test("devrait synchroniser les radios Clair/Sombre avec le bouton soleil/lune et persister", async ({ page, account }) => {
    void account;
    await page.goto("/parametres");
    const toggle = page.getByRole("banner").getByRole("button", { name: "Mode sombre" });
    const html = page.locator("html");

    await page.getByRole("radio", { name: "Sombre" }).check();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "Clair" })).toBeChecked();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(page.getByRole("radio", { name: "Sombre" })).toBeChecked();
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Sombre" })).toBeChecked();
    await expect(page.getByRole("banner").getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
  });

  test("devrait suivre l'appareil avec « Système » (préférence sombre émulée)", async ({ page, account }) => {
    void account;
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/parametres");
    await page.getByRole("radio", { name: "Clair" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "Système" }).check();
    await expect(page.getByRole("banner").getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Système" })).toBeChecked();
    await expect(page.getByRole("banner").getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.getByRole("banner").getByRole("button", { name: "Mode sombre" })).toHaveAttribute("aria-pressed", "false");
  });
});
