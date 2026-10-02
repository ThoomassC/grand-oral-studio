import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject, dialog, importThemeList, setEngine, type EngineChoice } from "./support/app";
import type { Page } from "@playwright/test";

test.afterAll(async () => {
  await deleteE2eUsers();
});

const BADGE: Record<"free" | "claude", string> = { free: "Sans IA · à compléter", claude: "Démo" };

function card(page: Page, theme: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: theme, level: 3 }) });
}

async function setup(page: Page, engine: EngineChoice, name: string): Promise<string> {
  await setEngine(page, engine);
  const id = await createProject(page, name);
  await importThemeList(page, id);
  await page.goto(`/projets/${id}/squelettes`);
  return id;
}

for (const engine of ["free", "claude"] as const) {
  test.describe(`6. Squelettes — moteur ${engine === "free" ? "Gratuit" : "démo (mock)"}`, () => {
    test("devrait générer les squelettes manquants avec le badge du moteur", async ({ page, account }) => {
      void account;
      await setup(page, engine, `Squelettes ${engine}`);
      await expect(card(page, "Cybersécurité").getByText("À générer")).toBeVisible();
      await page.getByRole("button", { name: "Générer les squelettes manquants (3)" }).click();
      await expect(page.getByText("3 squelettes générés.", { exact: true })).toBeVisible({ timeout: 60_000 });
      for (const theme of ["Cybersécurité", "Transformation numérique", "Intelligence artificielle"]) {
        await expect(card(page, theme).getByText("Généré", { exact: true })).toBeVisible();
        await expect(card(page, theme).getByText(BADGE[engine])).toBeVisible();
        await expect(card(page, theme).getByText(/^\d+ diapos$/)).toBeVisible();
      }
      await expect(page.getByRole("button", { name: /Générer les squelettes manquants/ })).toHaveCount(0);
      await expect(page.getByText("Préparation : 2/3 étapes")).toBeVisible();
    });

    test("devrait générer un seul thème, puis les manquants restants", async ({ page, account }) => {
      void account;
      await setup(page, engine, `Squelette unitaire ${engine}`);
      await page.getByRole("button", { name: "Générer le squelette Cybersécurité" }).click();
      await expect(card(page, "Cybersécurité").getByText("Généré", { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: "Générer les squelettes manquants (2)" })).toBeVisible();
      await page.getByRole("button", { name: "Générer les squelettes manquants (2)" }).click();
      await expect(page.getByText("2 squelettes générés.", { exact: true })).toBeVisible({ timeout: 60_000 });
    });

    test("devrait régénérer tout (modale) et un thème (modale)", async ({ page, account }) => {
      void account;
      await setup(page, engine, `Régénération ${engine}`);
      await page.getByRole("button", { name: "Générer les squelettes manquants (3)" }).click();
      await expect(page.getByText("3 squelettes générés.", { exact: true })).toBeVisible({ timeout: 60_000 });

      await page.getByRole("button", { name: "Régénérer tous les squelettes" }).click();
      const all = dialog(page, "Régénérer tous les squelettes ?");
      await expect(all).toContainText("Remplacer les 3 squelettes existants, y compris vos modifications ?");
      await page.keyboard.press("Escape");
      await expect(all).toBeHidden();
      await page.getByRole("button", { name: "Régénérer tous les squelettes" }).click();
      await all.getByRole("button", { name: "Remplacer les squelettes" }).click();
      await expect(page.getByText("3 squelettes générés.", { exact: true })).toBeVisible({ timeout: 60_000 });

      await page.getByRole("button", { name: "Régénérer le squelette Intelligence artificielle" }).click();
      const one = dialog(page, "Régénérer le squelette ?");
      await expect(one).toContainText("« Intelligence artificielle »");
      await one.getByRole("button", { name: "Remplacer le squelette" }).click();
      await expect(one).toBeHidden();
      await expect(card(page, "Intelligence artificielle").getByText("Généré", { exact: true })).toBeVisible({ timeout: 60_000 });
    });
  });
}

test.describe("6. Squelettes — ouvrir et modifier une diapo", () => {
  async function openSkeleton(page: Page): Promise<string> {
    const id = await setup(page, "free", "Édition de squelette");
    await page.getByRole("button", { name: "Générer le squelette Cybersécurité" }).click();
    await expect(card(page, "Cybersécurité").getByText("Généré", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("link", { name: "Ouvrir le squelette Cybersécurité" }).click();
    await expect(page).toHaveURL(new RegExp(`/projets/${id}/squelettes/[a-z0-9]+$`));
    await expect(page.getByText("Squelette · Cybersécurité")).toBeVisible();
    await expect(page.getByText("Trame sans IA")).toBeVisible();
    return id;
  }

  test("devrait limiter une diapo à 6 puces", async ({ page, account }) => {
    void account;
    await openSkeleton(page);
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    const add = page.getByRole("button", { name: "Ajouter une puce" });
    const hint = await page.getByText(/^\d\/6 puces/).textContent();
    const existing = Number(hint?.split("/")[0]);
    for (let i = existing; i < 6; i += 1) await add.click();
    await expect(page.getByText(/^6\/6 puces/)).toBeVisible();
    // 7e puce par le clavier (Entrée dans la dernière puce) : refusée aussi.
    await page.getByRole("textbox", { name: "Puce 6" }).press("Enter");
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Limite de 6 puces atteinte.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Puce \d$/ })).toHaveCount(6);
  });

  test("devrait demander confirmation sur Échap avec des modifications, puis abandonner", async ({ page, account }) => {
    void account;
    await openSkeleton(page);
    const slideTitle = page.getByRole("heading", { level: 3, name: /^Diapo 2 — / });
    const before = await slideTitle.textContent();
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    const title = page.getByRole("textbox", { name: "Titre", exact: true });
    await expect(title).toBeFocused();
    await title.fill("Titre jamais enregistré");
    await page.keyboard.press("Escape");
    const modal = dialog(page, "Abandonner vos modifications ?");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Continuer l'édition" }).click();
    await expect(modal).toBeHidden();
    await expect(title).toHaveValue("Titre jamais enregistré");
    await title.press("Escape");
    await dialog(page, "Abandonner vos modifications ?").getByRole("button", { name: "Abandonner" }).click();
    await expect(title).toHaveCount(0);
    await expect(slideTitle).toHaveText(before ?? "");
  });

  test("devrait fermer l'éditeur sur Échap sans modification, sans modale", async ({ page, account }) => {
    void account;
    await openSkeleton(page);
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Titre", exact: true })).toHaveCount(0);
    await expect(dialog(page, "Abandonner vos modifications ?")).toHaveCount(0);
  });

  test("devrait enregistrer une diapo modifiée et la garder après rechargement", async ({ page, account }) => {
    void account;
    await openSkeleton(page);
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    await page.getByRole("textbox", { name: "Titre", exact: true }).fill("Contexte de la cybersécurité");
    await page.getByRole("textbox", { name: "Puce 1" }).fill("Explosion des rançongiciels depuis 2020");
    await page.getByRole("textbox", { name: "Notes d'orateur" }).fill("Commencer par un chiffre marquant.");
    await page.getByRole("button", { name: "Enregistrer la diapo" }).click();
    await expect(page.getByText("Diapo 2 enregistrée.")).toBeAttached();
    await expect(page.getByRole("heading", { level: 3, name: "Diapo 2 — Contexte de la cybersécurité" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 3, name: "Diapo 2 — Contexte de la cybersécurité" })).toBeVisible();
    // Après rechargement, le streaming laisse un instant une copie masquée (div[hidden]) hors de <main>.
    const main = page.getByRole("main");
    await expect(main.getByRole("listitem").filter({ hasText: /^Explosion des rançongiciels depuis 2020$/ })).toBeVisible();
    await expect(main.getByText("Commencer par un chiffre marquant.", { exact: true })).toBeVisible();
  });

  test("devrait demander confirmation en quittant la page avec une diapo modifiée non enregistrée", async ({ page, account }) => {
    void account;
    const id = await openSkeleton(page);
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    await page.getByRole("textbox", { name: "Titre", exact: true }).fill("Modification en cours");
    await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: /Squelettes/ }).click();
    await expect(dialog(page, /Quitter sans enregistrer|Abandonner vos modifications/), "aucune confirmation avant d'abandonner la diapo modifiée").toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projets/${id}/squelettes/[a-z0-9]+$`));
  });

  test("devrait déclencher l'alerte native beforeunload en rechargeant avec une diapo modifiée", async ({ page, account }) => {
    void account;
    const id = await openSkeleton(page);
    const url = page.url();
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    await page.getByRole("textbox", { name: "Titre", exact: true }).fill("Modification en cours");
    const dialogPromise = page.waitForEvent("dialog");
    void page.reload().catch(() => undefined);
    const native = await dialogPromise;
    expect(native.type()).toBe("beforeunload");
    await native.dismiss();
    await expect(page).toHaveURL(url);
    await expect(page).toHaveURL(new RegExp(`/projets/${id}/squelettes/[a-z0-9]+$`));
    await expect(page.getByRole("textbox", { name: "Titre", exact: true })).toHaveValue("Modification en cours");
  });

  test("devrait demander confirmation sur « Précédent » et par l'en-tête avec une diapo modifiée", async ({ page, account }) => {
    void account;
    await openSkeleton(page);
    const url = page.url();
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    await page.getByRole("textbox", { name: "Titre", exact: true }).fill("Modification en cours");
    await page.goBack();
    const modal = dialog(page, "Quitter sans enregistrer ?");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Rester sur la page" }).click();
    await expect(page).toHaveURL(url);
    await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Projets" }).click();
    await expect(dialog(page, "Quitter sans enregistrer ?")).toBeVisible();
    await expect(page).toHaveURL(url);
  });

  test("ne devrait plus demander de confirmation après enregistrement de la diapo", async ({ page, account }) => {
    void account;
    const id = await openSkeleton(page);
    await page.getByRole("button", { name: "Modifier la diapo 2" }).click();
    await page.getByRole("textbox", { name: "Titre", exact: true }).fill("Titre enregistré");
    await page.getByRole("button", { name: "Enregistrer la diapo" }).click();
    await expect(page.getByText("Diapo 2 enregistrée.")).toBeAttached();
    await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: /Squelettes/ }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/squelettes`);
  });

  test("devrait revenir à la liste des squelettes par le fil d'Ariane", async ({ page, account }) => {
    void account;
    const id = await openSkeleton(page);
    await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: /Squelettes/ }).click();
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/squelettes`);
  });
});
