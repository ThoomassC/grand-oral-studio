import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";

test.afterAll(async () => {
  await deleteE2eUsers();
});

test.describe("2. Profil", () => {
  test("devrait présenter le menu du compte avec nom, e-mail et deux actions", async ({ page, account }) => {
    await page.goto("/projets");
    const trigger = page.getByRole("button", { name: `Compte : ${account.email}` });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Compte" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("group")).toContainText(account.email);
    await expect(menu.getByRole("group")).toContainText(account.name);
    await expect(menu.getByRole("menuitem")).toHaveText(["Informations du profil", "Se déconnecter"]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("devrait ouvrir /profil par « Informations du profil » et afficher le compte", async ({ page, account }) => {
    await page.goto("/projets");
    await page.getByRole("button", { name: `Compte : ${account.email}` }).click();
    await page.getByRole("menuitem", { name: "Informations du profil" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/profil`);
    await expect(page.getByRole("heading", { name: "Informations du profil", level: 1 })).toBeVisible();
    const infos = page.getByRole("region", { name: "Votre compte" });
    await expect(infos).toContainText(account.email);
    await expect(infos).toContainText("E-mail et mot de passe");
    await expect(infos).toContainText("0 projet");
  });

  test("devrait refuser un nom d'un caractère", async ({ page, account }) => {
    void account;
    await page.goto("/profil");
    await page.getByRole("textbox", { name: "Nom" }).fill("A");
    await page.getByRole("button", { name: "Enregistrer le nom" }).click();
    await expect(page.getByText("Indiquez votre nom (2 caractères au moins).")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Nom" })).toHaveAttribute("aria-invalid", "true");
  });

  test("devrait refuser un nom fait d'espaces", async ({ page, account }) => {
    void account;
    await page.goto("/profil");
    await page.getByRole("textbox", { name: "Nom" }).fill("     ");
    await page.getByRole("button", { name: "Enregistrer le nom" }).click();
    await expect(page.getByText("Indiquez votre nom (2 caractères au moins).")).toBeVisible();
  });

  test("devrait limiter la saisie du nom à 80 caractères", async ({ page, account }) => {
    void account;
    await page.goto("/profil");
    await expect(page.getByRole("textbox", { name: "Nom" })).toHaveAttribute("maxlength", "80");
  });

  test("devrait enregistrer un nom de 80 caractères et le montrer dans le menu après rechargement", async ({ page, account }) => {
    const name = `Nom ${"x".repeat(76)}`;
    expect(name).toHaveLength(80);
    await page.goto("/profil");
    await page.getByRole("textbox", { name: "Nom" }).fill(name);
    await page.getByRole("button", { name: "Enregistrer le nom" }).click();
    await expect(page.getByText("Nom enregistré.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Votre compte" })).toContainText(name);
    await page.getByRole("button", { name: `Compte : ${account.email}` }).click();
    await expect(page.getByRole("menu", { name: "Compte" }).getByRole("group")).toContainText(name);
  });

  test("devrait enregistrer un nom de 2 caractères (borne basse)", async ({ page, account }) => {
    void account;
    await page.goto("/profil");
    await page.getByRole("textbox", { name: "Nom" }).fill("Al");
    await page.getByRole("button", { name: "Enregistrer le nom" }).click();
    await expect(page.getByText("Nom enregistré.")).toBeVisible();
  });

  test("devrait afficher un nom contenant des balises comme du texte", async ({ page, account }) => {
    const name = `<img src=x onerror="window.__xss=1">Bob`;
    await page.goto("/profil");
    await page.getByRole("textbox", { name: "Nom" }).fill(name);
    await page.getByRole("button", { name: "Enregistrer le nom" }).click();
    await expect(page.getByText("Nom enregistré.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: `Compte : ${account.email}` }).click();
    await expect(page.getByRole("menu", { name: "Compte" }).getByRole("group")).toContainText(name);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("devrait répondre 404 à POST /api/auth/update-user (chemin désactivé)", async ({ page, account }) => {
    void account;
    const res = await page.request.post("/api/auth/update-user", {
      data: { name: "x" },
      headers: { Origin: BASE_URL },
    });
    expect(res.status()).toBe(404);
  });
});
