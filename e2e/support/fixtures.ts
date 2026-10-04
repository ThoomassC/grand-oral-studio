import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { recordDiagnostic } from "./diagnostics";
import { resetAuthRateLimit } from "./db";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const PASSWORD = "MotDePasse-E2E-2026";

/**
 * Ollama configuré pour le serveur testé (OLLAMA_BASE_URL, lue du .env par
 * playwright.config.ts comme par `next dev`). Absente (CI) : les tests qui exigent
 * un vrai modèle local sont sautés, et l'on vérifie à la place que le moteur est
 * présenté comme indisponible.
 */
export const OLLAMA_CONFIGURED = Boolean(process.env.OLLAMA_BASE_URL?.trim());
export const OLLAMA_SKIP_REASON = "OLLAMA_BASE_URL absente : pas de modèle local à interroger.";

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

/** Adresse unique `e2e-<zone>-<uuid>@example.test` (supprimée par deleteE2eUsers). */
export function uniqueEmail(zone: string): string {
  return `e2e-${zone}-${randomUUID().slice(0, 8)}@example.test`;
}

export function newUser(zone: string, name = "Testeur E2E"): TestUser {
  return { name, email: uniqueEmail(zone), password: PASSWORD };
}

/**
 * Inscription par l'API Better Auth (pose le cookie de session dans le
 * contexte). Le parcours d'inscription par le formulaire est testé à part.
 */
export async function signUpViaApi(request: APIRequestContext, user: TestUser): Promise<void> {
  await resetAuthRateLimit();
  const res = await request.post("/api/auth/sign-up/email", {
    data: { email: user.email, password: user.password, name: user.name },
    headers: { Origin: BASE_URL },
  });
  expect(res.status(), await res.text()).toBe(200);
}

export async function signInViaApi(request: APIRequestContext, user: TestUser): Promise<void> {
  await resetAuthRateLimit();
  const res = await request.post("/api/auth/sign-in/email", {
    data: { email: user.email, password: user.password },
    headers: { Origin: BASE_URL },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Nouveau contexte navigateur connecté avec un compte neuf. */
export async function loggedInContext(
  browser: { newContext: (o?: object) => Promise<BrowserContext> },
  zone: string,
  options: object = {},
): Promise<{ context: BrowserContext; page: Page; user: TestUser }> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "fr-FR", ...options });
  const user = newUser(zone);
  await signUpViaApi(context.request, user);
  const page = await context.newPage();
  watchPage(page, `${zone} (contexte partagé)`);
  return { context, page, user };
}

const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  // 4xx attendus (mauvais mot de passe, e-mail déjà pris, 404 voulus) : le navigateur les journalise.
  /Failed to load resource: the server responded with a status of 4\d\d/,
];

/** Collecte erreurs console, exceptions et réponses >= 500 (rapport en fin de suite). */
export function watchPage(page: Page, testName: string): void {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((r) => r.test(text))) return;
    recordDiagnostic({ kind: "console", test: testName, url: page.url(), text });
  });
  page.on("pageerror", (err) => {
    recordDiagnostic({ kind: "pageerror", test: testName, url: page.url(), text: `${err.name}: ${err.message}` });
  });
  page.on("response", (res) => {
    if (res.status() >= 500) {
      recordDiagnostic({ kind: "http", test: testName, url: page.url(), text: `${res.status()} ${res.request().method()} ${res.url()}` });
    }
  });
}

export const test = base.extend<{ watched: void; account: TestUser }>({
  watched: [
    async ({ page }, provide, testInfo) => {
      watchPage(page, testInfo.titlePath.slice(1).join(" › "));
      await provide();
    },
    { auto: true },
  ],
  /** Compte neuf, connecté dans le contexte de `page`. */
  account: async ({ page }, provide, testInfo) => {
    const zone = (testInfo.file.split("/").pop() ?? "x").replace(/\.spec\.ts$/, "").replace(/[^a-z0-9]+/gi, "-");
    const user = newUser(zone);
    await signUpViaApi(page.request, user);
    await provide(user);
  },
});

export { expect };

/** Aucun défilement horizontal de la page. */
export async function expectNoHorizontalScroll(page: Page, soft = false): Promise<void> {
  const dims = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  (soft ? expect.soft : expect)(dims.scroll, `${page.url()} : scrollWidth ${dims.scroll} > clientWidth ${dims.client}`).toBeLessThanOrEqual(dims.client);
}
