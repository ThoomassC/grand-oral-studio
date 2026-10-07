import { test, expect, BASE_URL } from "./support/fixtures";
import { deleteE2eUsers } from "./support/db";
import { createProject } from "./support/app";
import { chooseFreeWriter, generateDeck } from "./support/parcours";

test.afterAll(async () => {
  await deleteE2eUsers();
});

/**
 * Anciennes adresses (1.0) : redirections de next.config.ts, appliquées avant le
 * proxy d'authentification. Le statut et la cible se vérifient donc sans session,
 * avec un identifiant quelconque ; le parcours connecté vérifie la page d'arrivée.
 */
const ID = "e2eredirection0";
const DECK = "e2edeck0";

const PERMANENT: readonly [from: string, to: string][] = [
  [`/projets/${ID}/charte`, `/projets/${ID}/apparence`],
  [`/projets/${ID}/gabarit`, `/projets/${ID}/trame`],
  [`/projets/${ID}/squelettes`, `/projets/${ID}/decks`],
  [`/projets/${ID}/squelettes/${DECK}`, `/projets/${ID}/decks/${DECK}`],
  ["/parametres", "/configuration-ia"],
];

function targetOf(location: string | undefined): string {
  return new URL(location ?? "", BASE_URL).pathname;
}

test.describe("6. Redirections — statuts et cibles", () => {
  for (const [from, to] of PERMANENT) {
    test(`devrait rediriger ${from} vers ${to} en 308`, async ({ request }) => {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      expect(targetOf(res.headers()["location"])).toBe(to);
    });
  }

  test("devrait rediriger /projets/<id> vers son Apparence en 307 (temporaire)", async ({ request }) => {
    const res = await request.get(`/projets/${ID}`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(targetOf(res.headers()["location"])).toBe(`/projets/${ID}/apparence`);
  });
});

test.describe("6. Redirections — pages d'arrivée (connecté)", () => {
  test("devrait ouvrir l'Apparence, la Trame et les Decks depuis les anciennes adresses", async ({ page, account }) => {
    void account;
    const id = await createProject(page, "Anciennes adresses");
    const main = page.getByRole("main");

    await page.goto(`/projets/${id}`);
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/apparence`);
    await expect(main.getByRole("heading", { name: "Apparence", level: 2 })).toBeVisible();

    await page.goto(`/projets/${id}/charte`);
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/apparence`);
    await expect(main.getByRole("heading", { name: "Apparence", level: 2 })).toBeVisible();

    await page.goto(`/projets/${id}/gabarit`);
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/trame`);
    await expect(main.getByRole("heading", { name: "Trame", level: 2 })).toBeVisible();

    await page.goto(`/projets/${id}/squelettes`);
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/decks`);
    await expect(main.getByRole("heading", { name: "Diaporamas du jour J", level: 2 })).toBeVisible();
  });

  test("devrait ouvrir un deck depuis son ancienne adresse /squelettes/<deckId>", async ({ page, account }) => {
    void account;
    await chooseFreeWriter(page);
    const id = await createProject(page, "Ancienne adresse de deck");
    const deckId = await generateDeck(page, id, "Comment la sobriété numérique peut-elle réduire l'empreinte des entreprises ?", null);

    await page.goto(`/projets/${id}/squelettes/${deckId}`);
    await expect(page).toHaveURL(`${BASE_URL}/projets/${id}/decks/${deckId}`);
    await expect(page.getByRole("main").getByText("Diaporama final · Sans sujet")).toBeVisible();
  });
});
