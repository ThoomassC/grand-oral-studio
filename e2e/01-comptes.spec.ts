import { test, expect, newUser, signUpViaApi, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers, resetAuthRateLimit } from "./support/db";

test.afterAll(async () => {
  await deleteE2eUsers();
});

test.describe("1. Comptes — inscription", () => {
  test.beforeEach(async () => {
    await resetAuthRateLimit();
  });

  test("devrait signaler chaque champ invalide quand le formulaire est envoyé vide", async ({ page }) => {
    await page.goto("/inscription");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Indiquez votre nom (2 caractères au moins).")).toBeVisible();
    await expect(page.getByText("Adresse e-mail invalide.")).toBeVisible();
    await expect(page.getByText("Le mot de passe doit contenir au moins 10 caractères.")).toBeVisible();
    await expect(page.getByLabel("Nom")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Nom")).toBeFocused();
    await expect(page).toHaveURL(/\/inscription$/);
  });

  test("devrait refuser un mot de passe de 9 caractères", async ({ page }) => {
    const user = newUser("comptes");
    await page.goto("/inscription");
    await page.getByLabel("Nom").fill(user.name);
    await page.getByLabel("Adresse e-mail").fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("123456789");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Le mot de passe doit contenir au moins 10 caractères.")).toBeVisible();
    await expect(page).toHaveURL(/\/inscription$/);
  });

  test("devrait créer le compte et ouvrir /projets quand les champs sont valides", async ({ page }) => {
    const user = newUser("comptes");
    await page.goto("/inscription");
    await page.getByLabel("Nom").fill(user.name);
    await page.getByLabel("Adresse e-mail").fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page).toHaveURL(/\/projets$/);
    await expect(page.getByRole("heading", { name: "Projets", level: 1 })).toBeVisible();
  });

  test("devrait refuser une adresse déjà utilisée avec un message clair", async ({ page, browser }) => {
    const user = newUser("comptes");
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    await signUpViaApi(ctx.request, user);
    await ctx.close();

    await page.goto("/inscription");
    await page.getByLabel("Nom").fill("Autre personne");
    await page.getByLabel("Adresse e-mail").fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("UnAutreMotDePasse!");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Un compte existe déjà avec cette adresse" })).toBeVisible();
    await expect(page).toHaveURL(/\/inscription$/);
  });
});

test.describe("1. Comptes — connexion", () => {
  test.beforeEach(async () => {
    await resetAuthRateLimit();
  });

  test("devrait refuser un mauvais mot de passe sans quitter la page", async ({ page, browser }) => {
    const user = newUser("comptes");
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    await signUpViaApi(ctx.request, user);
    await ctx.close();

    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail").fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." })).toBeVisible();
    await expect(page).toHaveURL(/\/connexion$/);
    // La saisie de l'e-mail est conservée.
    await expect(page.getByLabel("Adresse e-mail")).toHaveValue(user.email);
  });

  test("devrait afficher puis masquer le mot de passe avec le bouton œil", async ({ page }) => {
    await page.goto("/connexion");
    const field = page.getByLabel("Mot de passe", { exact: true });
    const eye = page.getByRole("button", { name: "Afficher le mot de passe" });
    await field.fill("secret-visible");
    await expect(field).toHaveAttribute("type", "password");
    await expect(eye).toHaveAttribute("aria-pressed", "false");
    await eye.click();
    await expect(field).toHaveAttribute("type", "text");
    await expect(eye).toHaveAttribute("aria-pressed", "true");
    await expect(eye).toBeFocused();
    await eye.click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("devrait présenter le bouton « Continuer avec Google » actif", async ({ page }) => {
    await page.goto("/connexion");
    const google = page.getByRole("button", { name: "Continuer avec Google" });
    await expect(google).toBeVisible();
    await expect(google).not.toHaveAttribute("aria-disabled", "true");
    await page.goto("/inscription");
    await expect(page.getByRole("button", { name: "Continuer avec Google" })).toBeVisible();
  });

  test("devrait rediriger vers ?next= interne après connexion", async ({ page, browser }) => {
    const user = newUser("comptes");
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    await signUpViaApi(ctx.request, user);
    await ctx.close();

    await page.goto("/connexion?next=%2Fconfiguration-ia");
    await page.getByLabel("Adresse e-mail").fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/configuration-ia`);
  });

  for (const next of ["//evil.example", "/%09/evil.example", "https://evil.example/", "/\\evil.example"]) {
    test(`devrait rester sur le site quand ?next=${next}`, async ({ page, browser }) => {
      const user = newUser("comptes");
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      await signUpViaApi(ctx.request, user);
      await ctx.close();

      await page.goto(`/connexion?next=${next}`);
      await page.getByLabel("Adresse e-mail").fill(user.email);
      await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await expect(page).toHaveURL(`${BASE_URL}/projets`);
      expect(new URL(page.url()).host).toBe(new URL(BASE_URL).host);
    });
  }

  test("devrait conserver ?next= en passant de la connexion à l'inscription", async ({ page }) => {
    const user = newUser("comptes");
    await page.goto("/connexion?next=%2Fconfiguration-ia");
    await page.getByRole("link", { name: "Créer un compte" }).last().click();
    await expect(page).toHaveURL(`${BASE_URL}/inscription?next=%2Fconfiguration-ia`);
    await page.getByLabel("Nom").fill(user.name);
    await page.getByLabel("Adresse e-mail").fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/configuration-ia`);
  });

  test("devrait annoncer « Trop de tentatives » après 5 échecs de connexion en une minute", async ({ page, browser }) => {
    const user = newUser("comptes");
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    await signUpViaApi(ctx.request, user);
    await ctx.close();
    await resetAuthRateLimit();

    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail").fill(user.email);
    const password = page.getByLabel("Mot de passe", { exact: true });
    const submit = page.getByRole("button", { name: "Se connecter" });
    const wrong = page.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." });
    for (let i = 0; i < 5; i += 1) {
      await password.fill(`mauvais-${i}-mot-de-passe`);
      await submit.click();
      await expect(wrong).toBeVisible();
      await expect(submit).not.toHaveAttribute("aria-disabled", "true");
    }
    await password.fill(user.password);
    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "Trop de tentatives. Patientez une minute avant de réessayer." })).toBeVisible();
    await expect(page).toHaveURL(/\/connexion$/);
    await resetAuthRateLimit();
  });

  test("devrait renvoyer un utilisateur connecté de /connexion vers next (et pas vers un hôte externe)", async ({ page, account }) => {
    void account;
    await page.goto("/connexion?next=//evil.example");
    await expect(page).toHaveURL(`${BASE_URL}/projets`);
  });

  test("devrait se déconnecter par le menu du compte", async ({ page, account }) => {
    await page.goto("/projets");
    await page.getByRole("button", { name: `Compte : ${account.email}` }).click();
    await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(page.getByRole("banner").getByRole("link", { name: "Connexion" })).toBeVisible();
    await page.goto("/projets");
    await expect(page).toHaveURL(/\/connexion\?next=%2Fprojets$/);
  });
});

test.describe("1. Comptes — pages protégées et anciennes URL", () => {
  for (const path of ["/projets", "/configuration-ia", "/profil", "/projets/abc123/apparence", "/projets/abc123/trame/sujets"]) {
    test(`devrait rediriger ${path} vers /connexion?next= sans session`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(`${BASE_URL}/connexion?next=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
    });
  }

  test("devrait rediriger /programmes/... en 308 vers /projets/...", async ({ request }) => {
    const res = await request.get("/programmes/abc123/charte?x=1", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("/projets/abc123/charte?x=1");
    const root = await request.get("/programmes", { maxRedirects: 0 });
    expect(root.status()).toBe(308);
    expect(root.headers()["location"]).toBe("/projets");
  });

  test("devrait mener l'ancienne URL /charte à la connexion puis à /apparence sans session", async ({ page }) => {
    await page.goto("/projets/abc123/charte");
    await expect(page).toHaveURL(`${BASE_URL}/connexion?next=${encodeURIComponent("/projets/abc123/apparence")}`);
  });

  test("devrait rediriger l'ancienne page /parametres en 308 vers /configuration-ia", async ({ request }) => {
    const res = await request.get("/parametres?x=1", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("/configuration-ia?x=1");
    const sub = await request.get("/parametres/cle", { maxRedirects: 0 });
    expect(sub.status()).toBe(308);
    expect(sub.headers()["location"]).toBe("/configuration-ia/cle");
  });

  test("devrait mener /parametres à la connexion puis à /configuration-ia sans session", async ({ page }) => {
    await page.goto("/parametres");
    await expect(page).toHaveURL(`${BASE_URL}/connexion?next=${encodeURIComponent("/configuration-ia")}`);
  });
});

test.describe("1. Comptes — notes de version", () => {
  test("devrait ouvrir les notes de version sans session depuis le seul onglet de l'en-tête", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link")).toHaveText(["Notes de version"]);
    await nav.getByRole("link", { name: "Notes de version" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/notes-de-version`);
    await expect(page.getByRole("heading", { name: "Notes de version", level: 1 })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { name: "1.2.0", level: 2 })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Notes de version" })).toHaveAttribute("aria-current", "page");
  });

  test("devrait proposer Projets, Rédaction IA puis Notes de version à un compte connecté", async ({ page, account }) => {
    void account;
    await page.goto("/projets");
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link")).toHaveText(["Projets", "Rédaction IA", "Notes de version"]);
    await nav.getByRole("link", { name: "Notes de version" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/notes-de-version`);
    await expect(page.getByRole("heading", { name: "Notes de version", level: 1 })).toBeVisible();
  });
});
